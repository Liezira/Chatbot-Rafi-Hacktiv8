import "dotenv/config";
import express from "express";
import path from "path";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

// Sesuai brief: model bisa diganti di satu tempat lewat env var.
// gemini-2.5-flash dijadwalkan shutdown 16 Okt 2026 — pantau dan
// ganti ke gemini-3.x-flash kalau tanggal itu sudah dekat/lewat.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

// Memory storage: file diproses langsung dari buffer, tidak pernah
// ditulis ke disk (sesuai materi Sesi 2 — tidak perlu folder uploads/).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB, batas wajar untuk inlineData base64
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  if (!process.env.GEMINI_API_KEY) {
    console.warn(
      "[WARNING] GEMINI_API_KEY belum ter-set. Pastikan file .env berisi GEMINI_API_KEY=..."
    );
  }

  // Initialize Gemini API
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  app.use(express.json());

  // Endpoint teks biasa (di luar chat multi-turn), sesuai spesifikasi
  // Sesi 2: /generate-text
  app.post("/generate-text", async (req, res) => {
    try {
      const { prompt } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Field 'prompt' wajib diisi dan harus berupa teks." });
      }

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
      });

      if (!response?.text) {
        return res.status(502).json({ error: "Model tidak mengembalikan jawaban." });
      }

      res.json({ text: response.text });
    } catch (error: any) {
      console.error("Error /generate-text:", error);
      res.status(500).json({ error: error.message || "Failed to generate response" });
    }
  });

  // Helper bersama untuk 3 endpoint file di bawah: konversi buffer upload
  // multer ke inlineData base64, gabung dengan prompt (atau instruksi default).
  async function generateFromFile(
    file: Express.Multer.File | undefined,
    prompt: string | undefined,
    defaultPrompt: string
  ) {
    if (!file) {
      throw Object.assign(new Error("File wajib di-upload."), { statusCode: 400 });
    }

    const base64Data = file.buffer.toString("base64");
    const finalPrompt = prompt && prompt.trim().length > 0 ? prompt : defaultPrompt;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { text: finalPrompt },
            { inlineData: { mimeType: file.mimetype, data: base64Data } },
          ],
        },
      ],
    });

    if (!response?.text) {
      throw Object.assign(
        new Error("Model tidak mengembalikan jawaban (kemungkinan diblokir safety filter atau format file tidak didukung)."),
        { statusCode: 502 }
      );
    }

    return response.text;
  }

  // Endpoint 2: /generate-from-image
  // Body form-data: image (File), prompt (Text, opsional)
  app.post("/generate-from-image", upload.single("image"), async (req, res) => {
    try {
      const text = await generateFromFile(
        req.file,
        req.body.prompt,
        "Describe this image."
      );
      res.json({ text });
    } catch (error: any) {
      console.error("Error /generate-from-image:", error);
      res.status(error.statusCode || 500).json({ error: error.message || "Failed to generate response" });
    }
  });

  // Endpoint 3: /generate-from-document
  // Body form-data: document (File), prompt (Text, opsional)
  app.post("/generate-from-document", upload.single("document"), async (req, res) => {
    try {
      const text = await generateFromFile(
        req.file,
        req.body.prompt,
        "Summarize this document."
      );
      res.json({ text });
    } catch (error: any) {
      console.error("Error /generate-from-document:", error);
      res.status(error.statusCode || 500).json({ error: error.message || "Failed to generate response" });
    }
  });

  // Endpoint 4: /generate-from-audio
  // Body form-data: audio (File), prompt (Text, opsional)
  // Catatan: slide materi Sesi 2 menulis key form-data sebagai "document"
  // untuk endpoint audio ini (tampak salah ketik/copy-paste dari endpoint
  // dokumen) — di sini dipakai key "audio" yang lebih konsisten dan jelas.
  // Kalau dosen/rubrik menguji persis sesuai key di slide, tambahkan alias
  // upload.fields([{ name: "audio" }, { name: "document" }]) di bawah.
  app.post("/generate-from-audio", upload.single("audio"), async (req, res) => {
    try {
      const text = await generateFromFile(
        req.file,
        req.body.prompt,
        "Transcribe and summarize this audio."
      );
      res.json({ text });
    } catch (error: any) {
      console.error("Error /generate-from-audio:", error);
      res.status(error.statusCode || 500).json({ error: error.message || "Failed to generate response" });
    }
  });

  // API route for chat
  app.post("/api/chat", async (req, res) => {
    try {
      const { messages, temperature, topP, topK, systemPrompt } = req.body;

      // Validasi input — tanpa ini, messages kosong/salah format akan
      // meledak sebagai 500 generik yang membingungkan di client.
      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({
          error: "Field 'messages' harus berupa array dan tidak boleh kosong.",
        });
      }

      const latestMessage = messages[messages.length - 1];
      if (!latestMessage?.text || typeof latestMessage.text !== "string") {
        return res.status(400).json({
          error: "Pesan terakhir tidak memiliki teks yang valid.",
        });
      }

      const previousMessages = messages.slice(0, -1);

      const chatHistory = previousMessages.map((msg: any) => {
        const parts: any[] = [{ text: msg.text }];
        if (msg.file) parts.push({ inlineData: { mimeType: msg.file.mimeType, data: msg.file.data } });
        return {
          role: msg.role === 'user' ? 'user' : 'model',
          parts
        };
      });

      // Default system prompt if none is provided
      const finalSystemPrompt = systemPrompt || 
        "Kamu adalah Developer Assistant yang sangat manusiawi, ramah, dan empatik. Gunakan bahasa yang natural, santai namun profesional, seperti seorang teman diskusi atau mentor. Hindari bahasa robotik. Selalu jaga agar jawaban tetap ringkas, gunakan markdown untuk menyoroti poin-poin utama, dan tunjukkan empati terhadap proses belajar pengguna.";

      // Bug lama: `parseFloat(temperature) || 0.5` membuat temperature=0
      // (paling faktual, sesuai slider di UI) selalu tertimpa jadi 0.5,
      // karena 0 dianggap falsy di JS. Pakai Number.isFinite sebagai gantinya.
      const parsedTemperature = parseFloat(temperature);
      const finalTemperature = Number.isFinite(parsedTemperature) ? parsedTemperature : 0.5;

      const parsedTopP = parseFloat(topP);
      const parsedTopK = parseInt(topK, 10);

      const chat = ai.chats.create({
        model: GEMINI_MODEL,
        config: {
          systemInstruction: finalSystemPrompt,
          temperature: finalTemperature,
          ...(Number.isFinite(parsedTopP) ? { topP: parsedTopP } : {}),
          ...(Number.isFinite(parsedTopK) ? { topK: parsedTopK } : {}),
        },
        history: chatHistory
      });

      let response;
      let retries = 3;
      let delay = 1000;

      const messageParts: any[] = [{ text: latestMessage.text }];
      if (latestMessage.file) {
        messageParts.push({ inlineData: { mimeType: latestMessage.file.mimeType, data: latestMessage.file.data } });
      }

      while (retries > 0) {
        try {
          response = await chat.sendMessage({
            message: messageParts as any,
          });
          break; // Success, exit loop
        } catch (error: any) {
          if (error.status === 503 && retries > 1) {
            console.log(`API overloaded (503). Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            retries--;
            delay *= 2; // Exponential backoff
          } else {
            throw error; // Re-throw if it's not a 503 or we ran out of retries
          }
        }
      }

      if (!response?.text) {
        return res.status(502).json({
          error: "Model tidak mengembalikan jawaban (kemungkinan diblokir safety filter atau respons kosong).",
        });
      }

      res.json({ text: response.text });
    } catch (error: any) {
      console.error("Error generating response:", error);
      res.status(500).json({ error: error.message || "Failed to generate response" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
