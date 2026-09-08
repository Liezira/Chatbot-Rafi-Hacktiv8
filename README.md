<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Ruang Simulasi — Gemini AI Chatbot API

Final project: REST API ExpressJS terintegrasi dengan Google Gemini, dengan
frontend React (Vite) sebagai antarmuka chatbot.

## Run Locally

**Prerequisites:** Node.js v18+

1. Install dependencies:
   `npm install`
2. Salin `.env.example` menjadi `.env`, lalu isi `GEMINI_API_KEY` dengan API key kamu:
   `cp .env.example .env`
3. Jalankan aplikasi:
   `npm run dev`
4. Buka `http://localhost:3000`

## Endpoint API

| Endpoint | Method | Body | Keterangan |
|---|---|---|---|
| `/generate-text` | POST | JSON `{ "prompt": "..." }` | Generate teks dari prompt biasa |
| `/generate-from-image` | POST | form-data: `image` (File), `prompt` (opsional) | Deskripsi/analisis gambar |
| `/generate-from-document` | POST | form-data: `document` (File), `prompt` (opsional) | Ringkasan/analisis dokumen (PDF, TXT, dll) |
| `/generate-from-audio` | POST | form-data: `audio` (File), `prompt` (opsional) | Transkripsi/analisis audio |
| `/api/chat` | POST | JSON `{ "messages": [...], "temperature": 0.5, "topP": 0.9, "topK": 30, "systemPrompt": "..." }` | Chat multi-turn (dipakai oleh UI) |

Semua endpoint file memproses upload langsung dari memory buffer (tanpa
disimpan ke disk) menggunakan `multer`, lalu dikonversi ke base64 sebagai
`inlineData` untuk Gemini.

## Model

Model default: `gemini-2.5-flash`, bisa diganti lewat env var `GEMINI_MODEL`
tanpa ubah kode (lihat `.env.example`).

