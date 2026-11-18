import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AspectRatio,
  ExportCodec,
  ExportFormat,
  ExportResolution,
  Language,
  MediaAsset,
  Project,
} from '../../src/types/studio.js';
import {
  estimateGenerationCost,
  listModels,
  listProviders,
  runVideoGenerationJob,
  testProviderConnection,
} from '../adapters/registry.js';
import { encryptSecret, hashPassword, signToken, verifyPassword, verifySignedToken } from '../crypto.js';
import { db, rowToMediaAsset, rowToProject, saveProjectRecord } from '../db.js';
import {
  formatGeminiError,
  generateEnhancedVideoPrompt,
  generateImageWithGemini,
  generateMusicWithLyria,
  generateVoiceoverTts,
  getGeminiHttpStatus,
  prepareSpokenTextForAi,
  summarizeAndDirectVideo,
  transcribeAudioToSubtitles,
  transcribeSpeechOnly,
  translateText,
} from '../gemini.js';
import {
  classifyExportQuality,
  detectScenesWithFfmpeg,
  EXPORT_DIR,
  extractAudioWav,
  generateThumbnail,
  MEDIA_DIR,
  probeMedia,
  processAiVideoTool,
  renderTimelineExport,
  TEMP_DIR,
  THUMB_DIR,
} from '../services/ffmpegService.js';

export const apiRouter = express.Router();

// Simple in-memory sliding-window rate limiter per IP
const rateBuckets = new Map<string, number[]>();
function rateLimit(maxPerMinute: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const arr = (rateBuckets.get(key) ?? []).filter((t) => now - t < 60000);
    if (arr.length >= maxPerMinute) {
      res.status(429).json({ error: 'Rate limit exceeded. Please wait before retrying.' });
      return;
    }
    arr.push(now);
    rateBuckets.set(key, arr);
    next();
  };
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const pair of cookieHeader.split(';')) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    }
  }
  return out;
}

interface AuthedRequest extends Request {
  userId?: string;
  userRole?: 'admin' | 'creator';
}

function attachUser(req: AuthedRequest, res: Response, next: NextFunction): void {
  const cookies = parseCookies(req.headers.cookie);
  const rawToken = cookies.studio_session;
  let userId = 'user-studio-admin';

  if (rawToken) {
    const verified = verifySignedToken(rawToken);
    if (verified) {
      const exists = db.prepare('SELECT id, role FROM users WHERE id = ?').get(verified) as
        | { id: string; role: string }
        | undefined;
      if (exists) {
        userId = exists.id;
        req.userRole = exists.role as 'admin' | 'creator';
      }
    }
  }

  if (!req.userRole) {
    const defaultUser = db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId) as
      | { id: string; role: string }
      | undefined;
    req.userRole = (defaultUser?.role as 'admin' | 'creator') || 'admin';
  }
  req.userId = userId;
  next();
}

apiRouter.use(attachUser);

// Multer configuration for real media uploads (video, image, audio)
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, MEDIA_DIR),
  filename: (_req, file, cb) => {
    const safeExt = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin';
    cb(null, `upload_${crypto.randomUUID()}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.startsWith('video/') ||
      file.mimetype.startsWith('image/') ||
      file.mimetype.startsWith('audio/');
    if (!ok) {
      cb(new Error('Unsupported media format. Upload video, image, or audio files only.'));
      return;
    }
    cb(null, true);
  },
});

const uploadMic = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TEMP_DIR),
    filename: (_req, file, cb) => {
      const safeExt = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.webm';
      cb(null, `mic_${crypto.randomUUID()}${safeExt}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype.startsWith('audio/') || file.mimetype === 'video/webm';
    if (!ok) {
      cb(new Error('Unsupported microphone recording format.'));
      return;
    }
    cb(null, true);
  },
});

// ================= AUTH & SETTINGS =================

apiRouter.get('/auth/me', (req: AuthedRequest, res) => {
  const user = db.prepare('SELECT id, email, name, role, language, created_at FROM users WHERE id = ?').get(req.userId) as Record<
    string,
    unknown
  >;
  const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.userId) as Record<
    string,
    unknown
  >;
  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      language: user.language,
      createdAt: user.created_at,
    },
    settings: settings
      ? {
          userId: settings.user_id,
          defaultResolution: settings.default_resolution,
          defaultFps: settings.default_fps,
          defaultAspectRatio: settings.default_aspect_ratio,
          autosaveIntervalSec: settings.autosave_interval_sec,
          uiLanguage: settings.ui_language,
        }
      : null,
  });
});

apiRouter.post('/auth/register', (req, res) => {
  try {
    const { email, name, password, language } = req.body as {
      email: string;
      name: string;
      password: string;
      language?: Language;
    };
    if (!email || !password || !name) {
      res.status(400).json({ error: 'Name, email, and password are required.' });
      return;
    }
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) {
      res.status(409).json({ error: 'Account already exists with this email.' });
      return;
    }
    const id = `user-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO users (id, email, name, password_hash, role, language, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, email.toLowerCase(), name, hashPassword(password), 'creator', language || 'en', now);
    db.prepare(
      'INSERT INTO user_settings (user_id, default_resolution, default_fps, default_aspect_ratio, autosave_interval_sec, ui_language, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, '1080p', 30, '16:9', 15, language || 'en', now);

    const token = signToken(id);
    res.cookie('studio_session', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 86400000 });
    res.json({ ok: true, userId: id });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Registration failed' });
  }
});

apiRouter.post('/auth/login', (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase()) as
    | Record<string, unknown>
    | undefined;
  if (!user || !verifyPassword(password || '', String(user.password_hash))) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }
  const token = signToken(String(user.id));
  res.cookie('studio_session', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 86400000 });
  res.json({ ok: true, userId: user.id });
});

apiRouter.post('/auth/logout', (_req, res) => {
  res.clearCookie('studio_session');
  res.json({ ok: true });
});

apiRouter.patch('/settings', (req: AuthedRequest, res) => {
  const { defaultResolution, defaultFps, defaultAspectRatio, autosaveIntervalSec, uiLanguage } = req.body;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE user_settings SET
      default_resolution = COALESCE(?, default_resolution),
      default_fps = COALESCE(?, default_fps),
      default_aspect_ratio = COALESCE(?, default_aspect_ratio),
      autosave_interval_sec = COALESCE(?, autosave_interval_sec),
      ui_language = COALESCE(?, ui_language),
      updated_at = ?
    WHERE user_id = ?
  `).run(
    defaultResolution ?? null,
    defaultFps ?? null,
    defaultAspectRatio ?? null,
    autosaveIntervalSec ?? null,
    uiLanguage ?? null,
    now,
    req.userId
  );
  if (uiLanguage) {
    db.prepare('UPDATE users SET language = ? WHERE id = ?').run(uiLanguage, req.userId);
  }
  res.json({ ok: true });
});

// ================= PROJECTS & VERSIONS =================

apiRouter.get('/projects', (req: AuthedRequest, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const folder = String(req.query.folder || '').trim();
  const rows = db
    .prepare('SELECT * FROM projects ORDER BY updated_at DESC')
    .all() as Array<Record<string, unknown>>;
  let list = rows.map(rowToProject);
  if (q) {
    list = list.filter(
      (p) => p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    );
  }
  if (folder && folder !== 'All') {
    list = list.filter((p) => p.folder === folder);
  }
  res.json({ projects: list });
});

apiRouter.post('/projects', (req: AuthedRequest, res) => {
  const now = new Date().toISOString();
  const body = req.body as Partial<Project>;
  const project: Project = {
    id: `proj-${crypto.randomUUID()}`,
    userId: req.userId!,
    folder: body.folder || 'Workspace',
    title: body.title || 'Untitled Studio Project',
    description: body.description || '',
    aspectRatio: body.aspectRatio || '16:9',
    targetResolution: body.targetResolution || '1080p',
    targetFps: body.targetFps || 30,
    timeline: body.timeline || {
      tracks: [
        { id: 'trk-v1', kind: 'video', name: 'Video 1 (Main)', orderIndex: 0, muted: false, locked: false, volume: 1 },
        { id: 'trk-v2', kind: 'video', name: 'Video 2 (Overlay)', orderIndex: 1, muted: false, locked: false, volume: 1 },
        { id: 'trk-t1', kind: 'text', name: 'Titles & Subtitles', orderIndex: 2, muted: false, locked: false, volume: 1 },
        { id: 'trk-a1', kind: 'audio', name: 'Audio 1 (Voiceover)', orderIndex: 3, muted: false, locked: false, volume: 1 },
        { id: 'trk-a2', kind: 'audio', name: 'Audio 2 (Music)', orderIndex: 4, muted: false, locked: false, volume: 0.7 },
      ],
      clips: [],
      subtitles: [],
    },
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  saveProjectRecord(project, 'Initial project created');
  res.json({ project });
});

apiRouter.put('/projects/:id', (req, res) => {
  const existingRow = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined;
  if (!existingRow) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const existing = rowToProject(existingRow);
  const body = req.body as Partial<Project> & { versionLabel?: string };
  const nextVersion = body.versionLabel ? existing.version + 1 : existing.version;
  const updated: Project = {
    ...existing,
    folder: body.folder ?? existing.folder,
    title: body.title ?? existing.title,
    description: body.description ?? existing.description,
    aspectRatio: body.aspectRatio ?? existing.aspectRatio,
    targetResolution: body.targetResolution ?? existing.targetResolution,
    targetFps: body.targetFps ?? existing.targetFps,
    timeline: body.timeline ?? existing.timeline,
    version: nextVersion,
    updatedAt: new Date().toISOString(),
  };
  saveProjectRecord(updated, body.versionLabel);
  res.json({ project: updated });
});

apiRouter.post('/projects/:id/duplicate', (req: AuthedRequest, res) => {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const src = rowToProject(row);
  const now = new Date().toISOString();
  const copy: Project = {
    ...src,
    id: `proj-${crypto.randomUUID()}`,
    userId: req.userId!,
    title: `${src.title} (Copy)`,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  saveProjectRecord(copy, 'Duplicated project');
  res.json({ project: copy });
});

apiRouter.delete('/projects/:id', (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

apiRouter.get('/projects/:id/versions', (req, res) => {
  const rows = db
    .prepare('SELECT id, project_id, version, label, created_at FROM project_versions WHERE project_id = ? ORDER BY version DESC')
    .all(req.params.id);
  res.json({ versions: rows });
});

apiRouter.post('/projects/:id/versions/:versionId/restore', (req, res) => {
  const ver = db
    .prepare('SELECT * FROM project_versions WHERE id = ? AND project_id = ?')
    .get(req.params.versionId, req.params.id) as Record<string, unknown> | undefined;
  const projRow = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined;
  if (!ver || !projRow) {
    res.status(404).json({ error: 'Version or project not found' });
    return;
  }
  const proj = rowToProject(projRow);
  const restored: Project = {
    ...proj,
    timeline: JSON.parse(String(ver.timeline_json)),
    version: proj.version + 1,
    updatedAt: new Date().toISOString(),
  };
  saveProjectRecord(restored, `Restored from v${ver.version}`);
  res.json({ project: restored });
});

// ================= MEDIA ASSETS =================

apiRouter.get('/media', (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM media_assets ORDER BY created_at DESC')
    .all() as Array<Record<string, unknown>>;
  res.json({ media: rows.map(rowToMediaAsset) });
});

apiRouter.post('/media/upload', upload.single('file'), async (req: AuthedRequest, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No media file uploaded.' });
      return;
    }
    const kind = req.file.mimetype.startsWith('video/')
      ? 'video'
      : req.file.mimetype.startsWith('audio/')
        ? 'audio'
        : 'image';
    const mediaId = `asset-${crypto.randomUUID()}`;
    const filePath = req.file.path;
    const probed = await probeMedia(filePath);

    let thumbPath: string | null = null;
    if (kind === 'video') {
      thumbPath = path.join(THUMB_DIR, `${mediaId}.jpg`);
      try {
        await generateThumbnail(filePath, thumbPath);
      } catch {
        thumbPath = null;
      }
    } else if (kind === 'image') {
      thumbPath = filePath;
    }

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO media_assets (
        id, user_id, project_id, kind, title, filename, mime_type, file_path,
        thumbnail_path, duration_sec, width, height, fps, codec, is_native_4k, source_type, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      mediaId,
      req.userId!,
      req.body.projectId || null,
      kind,
      req.body.title || req.file.originalname,
      req.file.filename,
      req.file.mimetype,
      filePath,
      thumbPath,
      kind === 'image' ? 5 : probed.durationSec,
      probed.width,
      probed.height,
      probed.fps,
      probed.codec,
      probed.isNative4k ? 1 : 0,
      'upload',
      JSON.stringify({ originalName: req.file.originalname, sizeBytes: req.file.size }),
      now
    );

    const inserted = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(mediaId) as Record<
      string,
      unknown
    >;
    res.json({ media: rowToMediaAsset(inserted) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Media processing failed' });
  }
});

apiRouter.delete('/media/:id', (req, res) => {
  const row = db.prepare('SELECT file_path, source_type FROM media_assets WHERE id = ?').get(req.params.id) as
    | { file_path: string; source_type: string }
    | undefined;
  if (!row) {
    res.status(404).json({ error: 'Media asset not found' });
    return;
  }
  if (row.source_type !== 'starter' && fs.existsSync(row.file_path)) {
    fs.unlinkSync(row.file_path);
  }
  db.prepare('DELETE FROM media_assets WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

apiRouter.get('/media/:id/stream', (req, res) => {
  const row = db
    .prepare('SELECT file_path, mime_type FROM media_assets WHERE id = ?')
    .get(req.params.id) as { file_path: string; mime_type: string } | undefined;
  if (!row || !fs.existsSync(row.file_path)) {
    res.status(404).json({ error: 'Media file not found' });
    return;
  }
  const stat = fs.statSync(row.file_path);
  const range = req.headers.range;
  if (range && row.mime_type.startsWith('video/') || (range && row.mime_type.startsWith('audio/'))) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': row.mime_type,
    });
    fs.createReadStream(row.file_path, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': row.mime_type,
    });
    fs.createReadStream(row.file_path).pipe(res);
  }
});

apiRouter.get('/media/:id/thumbnail', (req, res) => {
  const row = db
    .prepare('SELECT thumbnail_path FROM media_assets WHERE id = ?')
    .get(req.params.id) as { thumbnail_path: string | null } | undefined;
  if (!row?.thumbnail_path || !fs.existsSync(row.thumbnail_path)) {
    res.status(404).end();
    return;
  }
  res.sendFile(path.resolve(row.thumbnail_path));
});

// ================= AI VIDEO GENERATOR & PROMPT ASSISTANT =================

apiRouter.get('/ai/registry', (_req, res) => {
  res.json({ providers: listProviders(), models: listModels() });
});

apiRouter.post('/ai/prompt-assist', rateLimit(20), async (req, res) => {
  try {
    const { idea, style, language } = req.body as {
      idea: string;
      style?: string;
      language?: Language;
    };
    if (!idea?.trim()) {
      res.status(400).json({ error: 'Enter a concept or prompt idea first.' });
      return;
    }
    const breakdown = await generateEnhancedVideoPrompt(
      idea,
      style || 'Cinematic 35mm',
      language || 'en'
    );
    res.json({ breakdown });
  } catch (err) {
    const formatted = formatGeminiError(err, 'PromptAssist');
    res.status(getGeminiHttpStatus(formatted)).json({ error: formatted });
  }
});

apiRouter.post('/ai/estimate-cost', (req, res) => {
  try {
    const { modelId, durationSec, resolution, aspectRatio } = req.body as {
      modelId: string;
      durationSec: number;
      resolution: string;
      aspectRatio: AspectRatio;
    };
    const estimate = estimateGenerationCost({ modelId, durationSec, resolution, aspectRatio });
    res.json({ estimate });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Estimation failed' });
  }
});

apiRouter.post('/ai/generate', rateLimit(15), (req: AuthedRequest, res) => {
  try {
    const { projectId, modelId, jobType, prompt, enhancedPrompt, params } = req.body as {
      projectId?: string;
      modelId: string;
      jobType: string;
      prompt: string;
      enhancedPrompt?: string;
      params: Record<string, unknown>;
    };
    const model = listModels().find((m) => m.modelId === modelId);
    if (!model) {
      res.status(400).json({ error: `Unknown model: ${modelId}` });
      return;
    }
    const estimate = estimateGenerationCost({
      modelId,
      durationSec: Number(params?.durationSec || 6),
      resolution: String(params?.resolution || '1080p'),
      aspectRatio: (params?.aspectRatio || '16:9') as AspectRatio,
    });

    const jobId = `job-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO generation_jobs (
        id, user_id, project_id, provider_id, model_id, job_type, prompt, enhanced_prompt,
        params_json, status, progress, estimated_cost_usd, actual_cost_usd, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      jobId,
      req.userId!,
      projectId || null,
      model.providerId,
      model.modelId,
      jobType || 'text_to_video',
      prompt || 'Studio motion clip',
      enhancedPrompt || null,
      JSON.stringify(params || {}),
      'queued',
      0,
      estimate.estimatedCostUsd,
      0,
      now,
      now
    );

    // Execute in background (never block HTTP request)
    setImmediate(() => {
      void runVideoGenerationJob(jobId);
    });

    res.json({ jobId, status: 'queued', estimate });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to enqueue job' });
  }
});

apiRouter.get('/jobs', (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM generation_jobs ORDER BY created_at DESC LIMIT 50')
    .all() as Array<Record<string, unknown>>;

  const jobs = rows.map((r) => {
    let outputMedia: MediaAsset | null = null;
    if (r.output_media_id) {
      const mRow = db
        .prepare('SELECT * FROM media_assets WHERE id = ?')
        .get(String(r.output_media_id)) as Record<string, unknown> | undefined;
      if (mRow) outputMedia = rowToMediaAsset(mRow);
    }
    return {
      id: String(r.id),
      userId: String(r.user_id),
      projectId: r.project_id ? String(r.project_id) : null,
      providerId: String(r.provider_id),
      modelId: String(r.model_id),
      jobType: String(r.job_type),
      prompt: String(r.prompt),
      enhancedPrompt: r.enhanced_prompt ? String(r.enhanced_prompt) : null,
      params: JSON.parse(String(r.params_json)),
      status: r.status,
      progress: Number(r.progress),
      estimatedCostUsd: Number(r.estimated_cost_usd),
      actualCostUsd: Number(r.actual_cost_usd),
      outputMediaId: r.output_media_id ? String(r.output_media_id) : null,
      outputMedia,
      errorMessage: r.error_message ? String(r.error_message) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  });
  res.json({ jobs });
});

apiRouter.post('/jobs/:id/retry', (req, res) => {
  const row = db.prepare('SELECT id FROM generation_jobs WHERE id = ?').get(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  db.prepare(
    "UPDATE generation_jobs SET status = 'queued', progress = 0, error_message = NULL, updated_at = ? WHERE id = ?"
  ).run(new Date().toISOString(), req.params.id);
  setImmediate(() => {
    void runVideoGenerationJob(req.params.id);
  });
  res.json({ ok: true });
});

// ================= AI VIDEO TOOLS (FFmpeg + Gemini) =================

apiRouter.post('/tools/process', rateLimit(15), async (req: AuthedRequest, res) => {
  try {
    const { mediaId, tool, chromaColor, similarity } = req.body as {
      mediaId: string;
      tool: 'upscale_4k' | 'enhance' | 'denoise_video' | 'denoise_audio' | 'chroma_key';
      chromaColor?: string;
      similarity?: number;
    };
    const row = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(mediaId) as
      | Record<string, unknown>
      | undefined;
    if (!row || !fs.existsSync(String(row.file_path))) {
      res.status(404).json({ error: 'Source media file not found.' });
      return;
    }

    const outFilename = `${tool}_${crypto.randomUUID()}.mp4`;
    const outPath = path.join(MEDIA_DIR, outFilename);
    await processAiVideoTool(String(row.file_path), outPath, tool, { chromaColor, similarity });
    const probed = await probeMedia(outPath);
    const thumbPath = path.join(THUMB_DIR, `${outFilename}.jpg`);
    await generateThumbnail(outPath, thumbPath);

    const newId = `asset-${crypto.randomUUID()}`;
    const labelMap: Record<string, string> = {
      upscale_4k: 'Upscaled 4K',
      enhance: 'Enhanced & Graded',
      denoise_video: 'Denoised',
      denoise_audio: 'Audio Cleaned',
      chroma_key: 'Chroma Keyed',
    };

    db.prepare(`
      INSERT INTO media_assets (
        id, user_id, project_id, kind, title, filename, mime_type, file_path,
        thumbnail_path, duration_sec, width, height, fps, codec, is_native_4k, source_type, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newId,
      req.userId!,
      row.project_id || null,
      'video',
      `${row.title} (${labelMap[tool]})`,
      outFilename,
      'video/mp4',
      outPath,
      thumbPath,
      probed.durationSec,
      probed.width,
      probed.height,
      probed.fps,
      probed.codec,
      0, // Upscaled 4K is NEVER falsely marked native 4K
      'ffmpeg_rendered',
      JSON.stringify({ derivedFrom: mediaId, tool, upscaled4k: tool === 'upscale_4k' }),
      new Date().toISOString()
    );

    const inserted = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(newId) as Record<
      string,
      unknown
    >;
    res.json({ media: rowToMediaAsset(inserted) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Video tool failed' });
  }
});

apiRouter.post('/tools/analyze', rateLimit(15), async (req, res) => {
  try {
    const { mediaId, language } = req.body as { mediaId: string; language?: Language };
    const row = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(mediaId) as
      | Record<string, unknown>
      | undefined;
    if (!row || !fs.existsSync(String(row.file_path))) {
      res.status(404).json({ error: 'Media asset not found.' });
      return;
    }

    const filePath = String(row.file_path);
    const sceneTimestamps = await detectScenesWithFfmpeg(filePath);
    let transcript = '';
    const probed = await probeMedia(filePath);
    if (probed.hasAudio) {
      const tmpWav = path.join(TEMP_DIR, `analyze_${crypto.randomUUID()}.wav`);
      try {
        await extractAudioWav(filePath, tmpWav);
        const stt = await transcribeAudioToSubtitles(tmpWav, 'audio/wav', language || 'en');
        transcript = stt.transcript;
      } catch {
        transcript = '';
      } finally {
        if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav);
      }
    }

    const aiAnalysis = await summarizeAndDirectVideo({
      title: String(row.title),
      durationSec: Number(row.duration_sec) || probed.durationSec,
      sceneTimestamps,
      transcript,
      language: language || 'en',
    });

    res.json({ sceneTimestamps, transcript, ...aiAnalysis });
  } catch (err) {
    const formatted = formatGeminiError(err, 'ToolsAnalyze');
    res.status(getGeminiHttpStatus(formatted)).json({ error: formatted });
  }
});

// ================= AI AUDIO STUDIO =================

apiRouter.post('/audio/tts', rateLimit(20), async (req: AuthedRequest, res) => {
  try {
    const {
      text,
      voiceName,
      style,
      language,
      dualSpeaker,
      secondSpeakerText,
      secondVoiceName,
      title,
    } = req.body as {
      text: string;
      voiceName: string;
      style?: string;
      language?: Language;
      dualSpeaker?: boolean;
      secondSpeakerText?: string;
      secondVoiceName?: string;
      title?: string;
    };
    if (!text?.trim()) {
      res.status(400).json({ error: 'Enter script text for voiceover generation.' });
      return;
    }

    const { buffer: wavBuffer, mimeType } = await generateVoiceoverTts({
      text,
      voiceName,
      style,
      language,
      dualSpeaker,
      secondSpeakerText,
      secondVoiceName,
    });

    const filename = `tts_${crypto.randomUUID()}.wav`;
    const filePath = path.join(MEDIA_DIR, filename);
    fs.writeFileSync(filePath, wavBuffer);
    const probed = await probeMedia(filePath);

    const mediaId = `asset-${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO media_assets (
        id, user_id, project_id, kind, title, filename, mime_type, file_path,
        thumbnail_path, duration_sec, width, height, fps, codec, is_native_4k, source_type, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      mediaId,
      req.userId!,
      null,
      'audio',
      title || `AI Voiceover (${voiceName})`,
      filename,
      mimeType,
      filePath,
      null,
      probed.durationSec,
      0,
      0,
      0,
      probed.codec || 'pcm_s16le',
      0,
      'ai_generated',
      JSON.stringify({ voiceName, language: language || 'en', dualSpeaker: Boolean(dualSpeaker) }),
      new Date().toISOString()
    );

    const inserted = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(mediaId) as Record<
      string,
      unknown
    >;
    res.json({ media: rowToMediaAsset(inserted) });
  } catch (err) {
    const formatted = formatGeminiError(err, 'AudioTTS');
    res.status(getGeminiHttpStatus(formatted)).json({ error: formatted });
  }
});

apiRouter.post(
  '/audio/mic-to-speech',
  rateLimit(20),
  uploadMic.single('audio'),
  async (req: AuthedRequest, res) => {
    const rawMicPath = req.file?.path;
    const wavMicPath = path.join(TEMP_DIR, `mic_norm_${crypto.randomUUID()}.wav`);
    try {
      if (!req.file || !rawMicPath) {
        res.status(400).json({ error: 'No microphone audio was received. Please record and try again.' });
        return;
      }

      const voiceName = String(req.body.voiceName || 'Kore');
      const style = req.body.style ? String(req.body.style) : undefined;
      const language = (req.body.language === 'hi' ? 'hi' : 'en') as Language;
      const mode = (
        req.body.mode === 'polish' || req.body.mode === 'reply' ? req.body.mode : 'exact'
      ) as 'exact' | 'polish' | 'reply';

      await extractAudioWav(rawMicPath, wavMicPath);
      const transcript = await transcribeSpeechOnly(wavMicPath, 'audio/wav');
      if (!transcript) {
        res.status(400).json({
          error:
            language === 'hi'
              ? 'माइक रिकॉर्डिंग में कोई स्पष्ट आवाज़ नहीं मिली। कृपया दोबारा स्पष्ट बोलें।'
              : 'No clear speech was detected in your microphone recording. Please speak clearly and try again.',
        });
        return;
      }

      const spokenText = await prepareSpokenTextForAi(transcript, language, mode);
      const { buffer: wavBuffer, mimeType } = await generateVoiceoverTts({
        text: spokenText,
        voiceName,
        style,
        language,
      });

      const filename = `mic_tts_${crypto.randomUUID()}.wav`;
      const filePath = path.join(MEDIA_DIR, filename);
      fs.writeFileSync(filePath, wavBuffer);
      const probed = await probeMedia(filePath);

      const mediaId = `asset-${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO media_assets (
          id, user_id, project_id, kind, title, filename, mime_type, file_path,
          thumbnail_path, duration_sec, width, height, fps, codec, is_native_4k, source_type, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mediaId,
        req.userId!,
        null,
        'audio',
        `Mic AI Voice (${voiceName})`,
        filename,
        mimeType,
        filePath,
        null,
        probed.durationSec,
        0,
        0,
        0,
        probed.codec || 'pcm_s16le',
        0,
        'ai_generated',
        JSON.stringify({ voiceName, language, mode, transcript }),
        new Date().toISOString()
      );

      const inserted = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(mediaId) as Record<
        string,
        unknown
      >;
      res.json({ transcript, spokenText, media: rowToMediaAsset(inserted) });
    } catch (err) {
      const formatted = formatGeminiError(err, 'MicToSpeech');
      res.status(getGeminiHttpStatus(formatted)).json({ error: formatted });
    } finally {
      if (rawMicPath && fs.existsSync(rawMicPath)) fs.unlinkSync(rawMicPath);
      if (fs.existsSync(wavMicPath)) fs.unlinkSync(wavMicPath);
    }
  }
);

apiRouter.post(
  '/audio/mic-transcribe',
  rateLimit(30),
  uploadMic.single('audio'),
  async (req: Request, res: Response) => {
    const rawMicPath = req.file?.path;
    const wavMicPath = path.join(TEMP_DIR, `mic_dict_${crypto.randomUUID()}.wav`);
    try {
      if (!req.file || !rawMicPath) {
        res.status(400).json({ error: 'No microphone audio was received. Please record and try again.' });
        return;
      }

      const language = (req.body.language === 'hi' ? 'hi' : 'en') as Language;
      const mode = req.body.mode === 'polish' ? 'polish' : 'exact';

      await extractAudioWav(rawMicPath, wavMicPath);
      const transcript = await transcribeSpeechOnly(wavMicPath, 'audio/wav');
      if (!transcript) {
        res.status(400).json({
          error:
            language === 'hi'
              ? 'माइक रिकॉर्डिंग में कोई स्पष्ट आवाज़ नहीं मिली। कृपया दोबारा स्पष्ट बोलें।'
              : 'No clear speech was detected in your microphone recording. Please speak clearly and try again.',
        });
        return;
      }

      const text =
        mode === 'polish'
          ? await prepareSpokenTextForAi(transcript, language, 'polish')
          : transcript;

      res.json({ transcript, text });
    } catch (err) {
      const formatted = formatGeminiError(err, 'MicTranscribe');
      res.status(getGeminiHttpStatus(formatted)).json({ error: formatted });
    } finally {
      if (rawMicPath && fs.existsSync(rawMicPath)) fs.unlinkSync(rawMicPath);
      if (fs.existsSync(wavMicPath)) fs.unlinkSync(wavMicPath);
    }
  }
);

apiRouter.post('/audio/stt', rateLimit(15), async (req, res) => {
  try {
    const { mediaId, targetLanguage } = req.body as { mediaId: string; targetLanguage?: string };
    const row = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(mediaId) as
      | Record<string, unknown>
      | undefined;
    if (!row || !fs.existsSync(String(row.file_path))) {
      res.status(404).json({ error: 'Media asset not found.' });
      return;
    }

    let audioPath = String(row.file_path);
    let mime = String(row.mime_type);
    let cleanupTmp = false;

    if (row.kind === 'video') {
      const probed = await probeMedia(audioPath);
      if (!probed.hasAudio) {
        res.status(400).json({ error: 'Selected video clip contains no audio track.' });
        return;
      }
      audioPath = path.join(TEMP_DIR, `stt_${crypto.randomUUID()}.wav`);
      await extractAudioWav(String(row.file_path), audioPath);
      mime = 'audio/wav';
      cleanupTmp = true;
    }

    try {
      const result = await transcribeAudioToSubtitles(audioPath, mime, targetLanguage || 'en');
      res.json(result);
    } finally {
      if (cleanupTmp && fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    }
  } catch (err) {
    const formatted = formatGeminiError(err, 'AudioSTT');
    res.status(getGeminiHttpStatus(formatted)).json({ error: formatted });
  }
});

apiRouter.post('/audio/translate', rateLimit(20), async (req, res) => {
  try {
    const { text, targetLanguage } = req.body as { text: string; targetLanguage: Language };
    const translated = await translateText(text, targetLanguage);
    res.json({ translated });
  } catch (err) {
    const formatted = formatGeminiError(err, 'AudioTranslate');
    res.status(getGeminiHttpStatus(formatted)).json({ error: formatted });
  }
});

apiRouter.post('/audio/music', rateLimit(10), async (req: AuthedRequest, res) => {
  try {
    const { prompt, modelId } = req.body as {
      prompt: string;
      modelId?: 'lyria-3-clip-preview' | 'lyria-3-pro-preview';
    };
    const result = await generateMusicWithLyria({
      prompt,
      modelId: modelId || 'lyria-3-clip-preview',
    });
    const filename = `lyria_${crypto.randomUUID()}.mp3`;
    const filePath = path.join(MEDIA_DIR, filename);
    fs.writeFileSync(filePath, result.buffer);
    const probed = await probeMedia(filePath);
    const mediaId = `asset-${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO media_assets (
        id, user_id, project_id, kind, title, filename, mime_type, file_path,
        thumbnail_path, duration_sec, width, height, fps, codec, is_native_4k, source_type, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      mediaId,
      req.userId!,
      null,
      'audio',
      `Lyria: ${prompt.slice(0, 36)}`,
      filename,
      result.mimeType,
      filePath,
      null,
      probed.durationSec || 30,
      0,
      0,
      0,
      probed.codec,
      0,
      'ai_generated',
      JSON.stringify({ lyrics: result.lyrics }),
      new Date().toISOString()
    );
    const inserted = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(mediaId) as Record<
      string,
      unknown
    >;
    res.json({ media: rowToMediaAsset(inserted), lyrics: result.lyrics });
  } catch (err) {
    const formatted = formatGeminiError(err, 'AudioMusic');
    res.status(getGeminiHttpStatus(formatted)).json({ error: formatted });
  }
});

// ================= AI IMAGE STUDIO =================

apiRouter.post('/image/generate', rateLimit(15), async (req: AuthedRequest, res) => {
  try {
    const { prompt, modelId, aspectRatio, imageSize, sourceMediaId } = req.body as {
      prompt: string;
      modelId?: 'gemini-3.1-flash-lite-image' | 'gemini-nano-banana-2.1';
      aspectRatio?: string;
      imageSize?: '1K' | '2K' | '4K';
      sourceMediaId?: string;
    };

    let sourceImageBase64: string | undefined;
    let sourceMimeType: string | undefined;
    if (sourceMediaId) {
      const m = db.prepare('SELECT file_path, mime_type FROM media_assets WHERE id = ?').get(sourceMediaId) as
        | { file_path: string; mime_type: string }
        | undefined;
      if (m && fs.existsSync(m.file_path)) {
        sourceImageBase64 = fs.readFileSync(m.file_path).toString('base64');
        sourceMimeType = m.mime_type;
      }
    }

    const result = await generateImageWithGemini({
      prompt,
      modelId: modelId || 'gemini-3.1-flash-lite-image',
      aspectRatio: aspectRatio || '16:9',
      imageSize: imageSize || '1K',
      sourceImageBase64,
      sourceMimeType,
    });

    const ext = result.mimeType.includes('png') ? 'png' : 'jpg';
    const filename = `studio_img_${crypto.randomUUID()}.${ext}`;
    const filePath = path.join(MEDIA_DIR, filename);
    fs.writeFileSync(filePath, result.buffer);
    const probed = await probeMedia(filePath);

    const mediaId = `asset-${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO media_assets (
        id, user_id, project_id, kind, title, filename, mime_type, file_path,
        thumbnail_path, duration_sec, width, height, fps, codec, is_native_4k, source_type, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      mediaId,
      req.userId!,
      null,
      'image',
      prompt.slice(0, 48),
      filename,
      result.mimeType,
      filePath,
      filePath,
      5,
      probed.width,
      probed.height,
      0,
      probed.codec,
      probed.width >= 3840 ? 1 : 0,
      'ai_generated',
      JSON.stringify({ modelId }),
      new Date().toISOString()
    );
    const inserted = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(mediaId) as Record<
      string,
      unknown
    >;
    res.json({ media: rowToMediaAsset(inserted) });
  } catch (err) {
    const formatted = formatGeminiError(err, 'ImageGenerate');
    res.status(getGeminiHttpStatus(formatted)).json({ error: formatted });
  }
});

// ================= 4K EXPORT QUEUE =================

async function runExportJob(exportId: string): Promise<void> {
  const row = db.prepare('SELECT * FROM export_jobs WHERE id = ?').get(exportId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return;

  const projRow = db.prepare('SELECT * FROM projects WHERE id = ?').get(String(row.project_id)) as
    | Record<string, unknown>
    | undefined;
  if (!projRow) {
    db.prepare("UPDATE export_jobs SET status = 'failed', error_message = 'Project missing' WHERE id = ?").run(exportId);
    return;
  }

  const project = rowToProject(projRow);
  const mediaMap = new Map<string, MediaAsset & { absPath: string }>();
  const usedIds = Array.from(
    new Set(project.timeline.clips.map((c) => c.mediaId).filter((id): id is string => Boolean(id)))
  );

  for (const id of usedIds) {
    const mRow = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (mRow && fs.existsSync(String(mRow.file_path))) {
      mediaMap.set(id, { ...rowToMediaAsset(mRow), absPath: String(mRow.file_path) });
    }
  }

  const ext = row.format === 'webm' ? 'webm' : 'mp4';
  const outPath = path.join(EXPORT_DIR, `${exportId}.${ext}`);

  const updateProgress = (pct: number) => {
    db.prepare('UPDATE export_jobs SET status = ?, progress = ?, updated_at = ? WHERE id = ?').run(
      'running',
      pct,
      new Date().toISOString(),
      exportId
    );
  };

  try {
    updateProgress(5);
    const verified = await renderTimelineExport({
      timeline: project.timeline,
      mediaMap,
      resolution: row.resolution as ExportResolution,
      aspectRatio: row.aspect_ratio as AspectRatio,
      fps: Number(row.fps),
      format: row.format as ExportFormat,
      codec: row.codec as ExportCodec,
      outPath,
      onProgress: updateProgress,
    });

    const sizeBytes = fs.statSync(outPath).size;
    db.prepare(`
      UPDATE export_jobs SET
        status = 'completed', progress = 100, output_path = ?, output_size_bytes = ?,
        verified_width = ?, verified_height = ?, verified_fps = ?, verified_codec = ?,
        error_message = NULL, updated_at = ?
      WHERE id = ?
    `).run(
      outPath,
      sizeBytes,
      verified.width,
      verified.height,
      verified.fps,
      verified.codec,
      new Date().toISOString(),
      exportId
    );
  } catch (err) {
    db.prepare(
      "UPDATE export_jobs SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?"
    ).run(err instanceof Error ? err.message : 'Export failed', new Date().toISOString(), exportId);
  }
}

apiRouter.post('/exports', (req: AuthedRequest, res) => {
  try {
    const { projectId, resolution, aspectRatio, fps, format, codec } = req.body as {
      projectId: string;
      resolution: ExportResolution;
      aspectRatio: AspectRatio;
      fps: number;
      format: ExportFormat;
      codec: ExportCodec;
    };
    const projRow = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as
      | Record<string, unknown>
      | undefined;
    if (!projRow) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const project = rowToProject(projRow);
    const sourceAssets: MediaAsset[] = [];
    for (const c of project.timeline.clips) {
      if (c.mediaId) {
        const mRow = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(c.mediaId) as
          | Record<string, unknown>
          | undefined;
        if (mRow) sourceAssets.push(rowToMediaAsset(mRow));
      }
    }
    const qualityClassification = classifyExportQuality(resolution, sourceAssets);
    const exportId = `exp-${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO export_jobs (
        id, user_id, project_id, project_title, resolution, aspect_ratio, fps,
        format, codec, quality_classification, status, progress, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      exportId,
      req.userId!,
      project.id,
      project.title,
      resolution,
      aspectRatio,
      fps,
      format,
      codec,
      qualityClassification,
      'queued',
      0,
      now,
      now
    );

    setImmediate(() => {
      void runExportJob(exportId);
    });

    res.json({ exportId, qualityClassification });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to start export' });
  }
});

apiRouter.get('/exports', (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM export_jobs ORDER BY created_at DESC LIMIT 50')
    .all() as Array<Record<string, unknown>>;
  const exportsList = rows.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    projectId: String(r.project_id),
    projectTitle: String(r.project_title),
    resolution: r.resolution,
    aspectRatio: r.aspect_ratio,
    fps: Number(r.fps),
    format: r.format,
    codec: r.codec,
    qualityClassification: r.quality_classification,
    status: r.status,
    progress: Number(r.progress),
    downloadUrl:
      r.status === 'completed' && r.output_path ? `/api/exports/${r.id}/download` : null,
    outputSizeBytes: r.output_size_bytes ? Number(r.output_size_bytes) : null,
    verifiedWidth: r.verified_width ? Number(r.verified_width) : null,
    verifiedHeight: r.verified_height ? Number(r.verified_height) : null,
    verifiedFps: r.verified_fps ? Number(r.verified_fps) : null,
    verifiedCodec: r.verified_codec ? String(r.verified_codec) : null,
    errorMessage: r.error_message ? String(r.error_message) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
  res.json({ exports: exportsList });
});

apiRouter.get('/exports/:id/download', (req, res) => {
  const row = db
    .prepare('SELECT output_path, project_title, format FROM export_jobs WHERE id = ?')
    .get(req.params.id) as { output_path: string; project_title: string; format: string } | undefined;
  if (!row?.output_path || !fs.existsSync(row.output_path)) {
    res.status(404).json({ error: 'Export file not found on disk.' });
    return;
  }
  const safeName = row.project_title.replace(/[^a-zA-Z0-9_-]/g, '_');
  res.download(path.resolve(row.output_path), `${safeName}.${row.format}`);
});

apiRouter.post('/exports/:id/retry', (req, res) => {
  const row = db.prepare('SELECT id FROM export_jobs WHERE id = ?').get(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Export job not found' });
    return;
  }
  db.prepare(
    "UPDATE export_jobs SET status = 'queued', progress = 0, error_message = NULL, updated_at = ? WHERE id = ?"
  ).run(new Date().toISOString(), req.params.id);
  setImmediate(() => {
    void runExportJob(req.params.id);
  });
  res.json({ ok: true });
});

// ================= ADMIN API PROVIDERS & BILLING =================

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (req.userRole !== 'admin') {
    res.status(403).json({ error: 'Admin privileges required for API provider configuration.' });
    return;
  }
  next();
}

apiRouter.get('/admin/providers', requireAdmin, (_req, res) => {
  res.json({ providers: listProviders(), models: listModels() });
});

apiRouter.patch('/admin/providers/:id', requireAdmin, (req, res) => {
  const { enabled, apiKey, rateLimitRpm, baseUrl } = req.body as {
    enabled?: boolean;
    apiKey?: string;
    rateLimitRpm?: number;
    baseUrl?: string;
  };
  const encrypted = apiKey && apiKey.trim() ? encryptSecret(apiKey.trim()) : undefined;
  db.prepare(`
    UPDATE ai_providers SET
      enabled = COALESCE(?, enabled),
      encrypted_api_key = COALESCE(?, encrypted_api_key),
      rate_limit_rpm = COALESCE(?, rate_limit_rpm),
      base_url = COALESCE(?, base_url),
      status = CASE WHEN ? IS NOT NULL THEN 'ready' ELSE status END
    WHERE id = ?
  `).run(
    enabled === undefined ? null : enabled ? 1 : 0,
    encrypted ?? null,
    rateLimitRpm ?? null,
    baseUrl ?? null,
    encrypted ?? null,
    req.params.id
  );
  res.json({ providers: listProviders() });
});

apiRouter.post('/admin/providers/:id/test', requireAdmin, async (req, res) => {
  try {
    const result = await testProviderConnection(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, message: err instanceof Error ? err.message : 'Test failed' });
  }
});

apiRouter.post('/admin/providers', requireAdmin, (req, res) => {
  const { name, slug, category, baseUrl, apiKey, rateLimitRpm } = req.body as {
    name: string;
    slug: string;
    category: 'video' | 'image' | 'audio' | 'text';
    baseUrl: string;
    apiKey?: string;
    rateLimitRpm?: number;
  };
  if (!name || !slug || !baseUrl) {
    res.status(400).json({ error: 'Name, slug, and base URL are required.' });
    return;
  }
  const id = `prov-${crypto.randomUUID()}`;
  const encrypted = apiKey?.trim() ? encryptSecret(apiKey.trim()) : null;
  db.prepare(`
    INSERT INTO ai_providers (id, slug, name, category, enabled, auth_type, base_url, encrypted_api_key, rate_limit_rpm, status)
    VALUES (?, ?, ?, ?, ?, 'bearer_key', ?, ?, ?, ?)
  `).run(
    id,
    slug.toLowerCase().replace(/[^a-z0-9-_]/g, '-'),
    name,
    category || 'video',
    1,
    baseUrl,
    encrypted,
    rateLimitRpm || 30,
    encrypted ? 'ready' : 'unconfigured'
  );
  res.json({ providers: listProviders() });
});

apiRouter.post('/admin/models', requireAdmin, (req, res) => {
  const {
    providerId,
    modelId,
    displayName,
    capabilityType,
    supportedResolutions,
    native4k,
    supportedAspectRatios,
    minDurationSec,
    maxDurationSec,
    supportsAudio,
    pricingPerSecUsd,
    pricingPerCallUsd,
  } = req.body;
  if (!providerId || !modelId || !displayName) {
    res.status(400).json({ error: 'Provider, model ID, and display name are required.' });
    return;
  }
  db.prepare(`
    INSERT INTO ai_models (
      id, provider_id, model_id, display_name, capability_type,
      supported_resolutions_json, native_4k, supported_aspect_ratios_json,
      min_duration_sec, max_duration_sec, supports_audio, input_types_json,
      pricing_per_sec_usd, pricing_per_call_usd, free_tier_available, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'requires_provider_key')
  `).run(
    `mod-${crypto.randomUUID()}`,
    providerId,
    modelId,
    displayName,
    capabilityType || 'text_to_video',
    JSON.stringify(supportedResolutions || ['720p', '1080p']),
    native4k ? 1 : 0,
    JSON.stringify(supportedAspectRatios || ['16:9', '9:16']),
    minDurationSec ?? 3,
    maxDurationSec ?? 10,
    supportsAudio ? 1 : 0,
    JSON.stringify(['text', 'image']),
    pricingPerSecUsd ?? 0.08,
    pricingPerCallUsd ?? 0
  );
  res.json({ models: listModels() });
});

apiRouter.get('/billing/summary', (req: AuthedRequest, res) => {
  const rows = db
    .prepare(`
      SELECT u.*, p.name as provider_name
      FROM api_usage u LEFT JOIN ai_providers p ON u.provider_id = p.id
      ORDER BY u.created_at DESC LIMIT 50
    `)
    .all() as Array<Record<string, unknown>>;

  let totalSpentUsd = 0;
  let freeOperationsCount = 0;
  let paidOperationsCount = 0;

  const usage = rows.map((r) => {
    const cost = Number(r.cost_usd);
    totalSpentUsd += cost;
    if (cost > 0) paidOperationsCount++;
    else freeOperationsCount++;
    return {
      id: String(r.id),
      providerId: String(r.provider_id),
      providerName: String(r.provider_name || r.provider_id),
      modelId: String(r.model_id),
      jobId: r.job_id ? String(r.job_id) : null,
      units: String(r.units),
      costUsd: cost,
      status: r.status as 'success' | 'failed',
      createdAt: String(r.created_at),
    };
  });

  res.json({
    totalSpentUsd: Math.round(totalSpentUsd * 1000) / 1000,
    freeOperationsCount,
    paidOperationsCount,
    usage,
  });
});
