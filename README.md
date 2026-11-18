# AI Video Studio 4K

All-in-one AI video creation, multi-track timeline editing, bilingual (English & Hindi) AI audio studio, and verified 4K FFmpeg mastering platform.

## Architecture & Folder Structure

- `server.ts` — Express full-stack server on port `3000` integrating API routes, media streaming (`Range` requests), FFmpeg background workers, and Vite middleware.
- `server/db.ts` — SQLite schema (`storage/studio.db`) with relational tables for `users`, `user_settings`, `projects`, `project_versions`, `media_assets`, `timeline_tracks`, `timeline_clips`, `ai_providers`, `ai_models`, `generation_jobs`, `export_jobs`, `api_usage`, and `billing_records`.
- `server/crypto.ts` — AES-256-GCM provider secret encryption, scrypt password hashing, and HMAC-SHA256 session cookies.
- `server/gemini.ts` — Server-side `@google/genai` integration (`gemini-4-hydrogen`, `gemini-3.8-flash-lite-tts`, `gemini-3.8-flash-tts`, `gemini-3.5-transcribe`, `gemini-nano-banana-2.1`, `gemini-3.1-flash-lite-image`, `lyria-3-clip-preview`, `gemini-omni-1.2-flash`).
- `server/adapters/registry.ts` — Modular AI Provider Adapter System with capability validation, pre-generation cost estimation, connection testing, and safe retry logic.
- `server/services/ffmpegService.ts` — FFmpeg & FFprobe engine for media probing, thumbnail generation, 4K Ken Burns motion composition, Lanczos 4K upscaling, denoising, chroma keying, scene detection, audio extraction, and multi-track timeline export (`H.264`, `H.265`, `VP9` in `MP4`/`WebM`).
- `src/` — React 19 + TypeScript + Tailwind CSS v4 frontend modules.
- `tests/studio.test.ts` — Automated tests for encryption, 4K quality classification, and FFmpeg/FFprobe video rendering.

## Core API Endpoints

- `GET /api/health` — Server health check.
- `GET /api/auth/me`, `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/logout` — Session authentication.
- `GET/POST /api/projects`, `PUT/DELETE /api/projects/:id`, `POST /api/projects/:id/duplicate`, `GET /api/projects/:id/versions` — Project management & version history.
- `GET /api/media`, `POST /api/media/upload`, `GET /api/media/:id/stream`, `GET /api/media/:id/thumbnail` — Media ingestion and range-enabled streaming.
- `GET /api/ai/registry`, `POST /api/ai/prompt-assist`, `POST /api/ai/estimate-cost`, `POST /api/ai/generate`, `GET /api/jobs`, `POST /api/jobs/:id/retry` — Modular AI generation pipeline.
- `POST /api/tools/process`, `POST /api/tools/analyze` — FFmpeg video enhancement, 4K upscaling, denoising, chroma key, and scene detection + Gemini summarization.
- `POST /api/audio/tts`, `POST /api/audio/stt`, `POST /api/audio/translate`, `POST /api/audio/music` — Voiceover, dual-speaker screenplay TTS, subtitle extraction, EN/HI translation, and music.
- `POST /api/image/generate` — Image generation & editing.
- `POST /api/exports`, `GET /api/exports`, `GET /api/exports/:id/download`, `POST /api/exports/:id/retry` — Background 4K export queue with FFprobe verification.
- `GET/POST/PATCH /api/admin/providers`, `POST /api/admin/providers/:id/test`, `GET /api/billing/summary` — Admin API management and cost ledger.

## Running & Deployment

```bash
# Development server (port 3000)
npm run dev

# Type check & automated tests
npm run lint
npm test

# Production build & start
npm run build
npm start
```
