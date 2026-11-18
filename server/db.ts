import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AIModelCapability,
  AIProvider,
  AspectRatio,
  Project,
  TimelineState,
} from '../src/types/studio.js';
import { hashPassword } from './crypto.js';
import {
  createKenBurnsVideo,
  generateThumbnail,
  MEDIA_DIR,
  probeMedia,
  STORAGE_ROOT,
  THUMB_DIR,
} from './services/ffmpegService.js';

const DB_PATH = path.join(STORAGE_ROOT, 'studio.db');
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'creator',
      language TEXT NOT NULL DEFAULT 'en',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      default_resolution TEXT NOT NULL DEFAULT '1080p',
      default_fps INTEGER NOT NULL DEFAULT 30,
      default_aspect_ratio TEXT NOT NULL DEFAULT '16:9',
      autosave_interval_sec INTEGER NOT NULL DEFAULT 15,
      ui_language TEXT NOT NULL DEFAULT 'en',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      folder TEXT NOT NULL DEFAULT 'Workspace',
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      aspect_ratio TEXT NOT NULL DEFAULT '16:9',
      target_resolution TEXT NOT NULL DEFAULT '1080p',
      target_fps INTEGER NOT NULL DEFAULT 30,
      timeline_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      label TEXT NOT NULL,
      timeline_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_assets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      thumbnail_path TEXT,
      duration_sec REAL NOT NULL DEFAULT 0,
      width INTEGER NOT NULL DEFAULT 0,
      height INTEGER NOT NULL DEFAULT 0,
      fps REAL NOT NULL DEFAULT 30,
      codec TEXT NOT NULL DEFAULT 'h264',
      is_native_4k INTEGER NOT NULL DEFAULT 0,
      source_type TEXT NOT NULL DEFAULT 'upload',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS timeline_tracks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      muted INTEGER NOT NULL DEFAULT 0,
      locked INTEGER NOT NULL DEFAULT 0,
      volume REAL NOT NULL DEFAULT 1.0
    );

    CREATE TABLE IF NOT EXISTS timeline_clips (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES timeline_tracks(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      media_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      start_sec REAL NOT NULL,
      duration_sec REAL NOT NULL,
      in_sec REAL NOT NULL DEFAULT 0,
      out_sec REAL NOT NULL DEFAULT 5,
      properties_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_providers (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      auth_type TEXT NOT NULL,
      base_url TEXT NOT NULL DEFAULT '',
      encrypted_api_key TEXT,
      rate_limit_rpm INTEGER NOT NULL DEFAULT 30,
      status TEXT NOT NULL DEFAULT 'ready',
      last_tested_at TEXT,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS ai_models (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
      model_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      capability_type TEXT NOT NULL,
      supported_resolutions_json TEXT NOT NULL,
      native_4k INTEGER NOT NULL DEFAULT 0,
      supported_aspect_ratios_json TEXT NOT NULL,
      min_duration_sec INTEGER NOT NULL DEFAULT 3,
      max_duration_sec INTEGER NOT NULL DEFAULT 15,
      supports_audio INTEGER NOT NULL DEFAULT 0,
      input_types_json TEXT NOT NULL,
      pricing_per_sec_usd REAL NOT NULL DEFAULT 0,
      pricing_per_call_usd REAL NOT NULL DEFAULT 0,
      free_tier_available INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS generation_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      job_type TEXT NOT NULL,
      prompt TEXT NOT NULL,
      enhanced_prompt TEXT,
      params_json TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd REAL NOT NULL DEFAULT 0,
      actual_cost_usd REAL NOT NULL DEFAULT 0,
      output_media_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS export_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      project_title TEXT NOT NULL,
      resolution TEXT NOT NULL,
      aspect_ratio TEXT NOT NULL,
      fps INTEGER NOT NULL,
      format TEXT NOT NULL,
      codec TEXT NOT NULL,
      quality_classification TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      output_path TEXT,
      output_size_bytes INTEGER,
      verified_width INTEGER,
      verified_height INTEGER,
      verified_fps REAL,
      verified_codec TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_usage (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      job_id TEXT,
      units TEXT NOT NULL,
      cost_usd REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS billing_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      mode TEXT NOT NULL DEFAULT 'free_editing',
      created_at TEXT NOT NULL
    );
  `);
}

export async function seedInitialData(): Promise<void> {
  const now = new Date().toISOString();

  // Seed default Admin + Studio Creator account
  const adminExists = db.prepare('SELECT id FROM users WHERE id = ?').get('user-studio-admin');
  if (!adminExists) {
    db.prepare(
      'INSERT INTO users (id, email, name, password_hash, role, language, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      'user-studio-admin',
      'studio@aivideostudio.local',
      'Studio Director',
      hashPassword('studio4k-admin'),
      'admin',
      'en',
      now
    );
    db.prepare(
      'INSERT INTO user_settings (user_id, default_resolution, default_fps, default_aspect_ratio, autosave_interval_sec, ui_language, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('user-studio-admin', '1080p', 30, '16:9', 15, 'en', now);
  }

  // Seed AI Providers
  const providers: Array<Omit<AIProvider, 'hasApiKey'> & { encrypted_api_key?: string | null }> = [
    {
      id: 'prov-local-ffmpeg',
      slug: 'local-ffmpeg',
      name: 'Local FFmpeg Motion & 4K Engine',
      category: 'video',
      enabled: true,
      authType: 'local_ffmpeg',
      baseUrl: 'local://ffmpeg',
      rateLimitRpm: 120,
      status: 'ready',
      lastTestedAt: now,
      lastError: null,
    },
    {
      id: 'prov-gemini-core',
      slug: 'google-gemini',
      name: 'Google Gemini Multimodal & Speech',
      category: 'text',
      enabled: true,
      authType: 'env_gemini',
      baseUrl: 'https://generativelanguage.googleapis.com',
      rateLimitRpm: 60,
      status: process.env.GEMINI_API_KEY ? 'ready' : 'unconfigured',
      lastTestedAt: now,
      lastError: null,
    },
    {
      id: 'prov-gemini-veo',
      slug: 'google-veo-omni',
      name: 'Google Veo / Omni Flash Video',
      category: 'video',
      enabled: true,
      authType: 'env_gemini',
      baseUrl: 'https://generativelanguage.googleapis.com',
      rateLimitRpm: 15,
      status: 'ready',
      lastTestedAt: now,
      lastError: null,
    },
    {
      id: 'prov-runway',
      slug: 'runway',
      name: 'Runway Gen-4 API',
      category: 'video',
      enabled: false,
      authType: 'bearer_key',
      baseUrl: 'https://api.dev.runwayml.com/v1',
      rateLimitRpm: 20,
      status: 'unconfigured',
      lastTestedAt: null,
      lastError: null,
    },
    {
      id: 'prov-kling',
      slug: 'kling',
      name: 'Kling AI Video API',
      category: 'video',
      enabled: false,
      authType: 'bearer_key',
      baseUrl: 'https://api.klingai.com/v1',
      rateLimitRpm: 20,
      status: 'unconfigured',
      lastTestedAt: null,
      lastError: null,
    },
  ];

  const insertProv = db.prepare(`
    INSERT OR IGNORE INTO ai_providers (id, slug, name, category, enabled, auth_type, base_url, rate_limit_rpm, status, last_tested_at, last_error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const p of providers) {
    insertProv.run(
      p.id,
      p.slug,
      p.name,
      p.category,
      p.enabled ? 1 : 0,
      p.authType,
      p.baseUrl,
      p.rateLimitRpm,
      p.status,
      p.lastTestedAt,
      p.lastError
    );
  }

  // Seed AI Model Capability Registry
  const models: Array<Omit<AIModelCapability, 'providerName' | 'providerSlug'>> = [
    {
      id: 'mod-ffmpeg-motion',
      providerId: 'prov-local-ffmpeg',
      modelId: 'ffmpeg-kenburns-4k',
      displayName: 'FFmpeg Motion & Title Composer (Zero-Budget)',
      capabilityType: 'image_to_video',
      supportedResolutions: ['720p', '1080p', '1440p', '2160p'],
      native4k: true,
      supportedAspectRatios: ['16:9', '9:16', '1:1', '4:5', '21:9'],
      minDurationSec: 2,
      maxDurationSec: 30,
      supportsAudio: false,
      inputTypes: ['image', 'text'],
      pricingPerSecUsd: 0,
      pricingPerCallUsd: 0,
      freeTierAvailable: true,
      status: 'active',
    },
    {
      id: 'mod-omni-video',
      providerId: 'prov-gemini-veo',
      modelId: 'gemini-omni-1.2-flash',
      displayName: 'Gemini Omni Flash / Veo Video',
      capabilityType: 'text_to_video',
      supportedResolutions: ['720p', '1080p', '4k'],
      native4k: true,
      supportedAspectRatios: ['16:9', '9:16'],
      minDurationSec: 3,
      maxDurationSec: 15,
      supportsAudio: true,
      inputTypes: ['text', 'image', 'video'],
      pricingPerSecUsd: 0.12,
      pricingPerCallUsd: 0,
      freeTierAvailable: false,
      status: 'requires_paid_key',
    },
    {
      id: 'mod-runway-gen4',
      providerId: 'prov-runway',
      modelId: 'gen4_turbo',
      displayName: 'Runway Gen-4 Turbo',
      capabilityType: 'image_to_video',
      supportedResolutions: ['720p', '1080p'],
      native4k: false,
      supportedAspectRatios: ['16:9', '9:16', '1:1'],
      minDurationSec: 5,
      maxDurationSec: 10,
      supportsAudio: false,
      inputTypes: ['text', 'image'],
      pricingPerSecUsd: 0.08,
      pricingPerCallUsd: 0,
      freeTierAvailable: false,
      status: 'requires_provider_key',
    },
    {
      id: 'mod-kling-v2',
      providerId: 'prov-kling',
      modelId: 'kling-v2-master',
      displayName: 'Kling v2 Master',
      capabilityType: 'text_to_video',
      supportedResolutions: ['720p', '1080p'],
      native4k: false,
      supportedAspectRatios: ['16:9', '9:16', '1:1'],
      minDurationSec: 5,
      maxDurationSec: 10,
      supportsAudio: true,
      inputTypes: ['text', 'image'],
      pricingPerSecUsd: 0.1,
      pricingPerCallUsd: 0,
      freeTierAvailable: false,
      status: 'requires_provider_key',
    },
    {
      id: 'mod-gemini-hydrogen',
      providerId: 'prov-gemini-core',
      modelId: 'gemini-4-hydrogen',
      displayName: 'Gemini 4 Hydrogen (Prompt & Story Director)',
      capabilityType: 'prompt_llm',
      supportedResolutions: [],
      native4k: false,
      supportedAspectRatios: ['16:9'],
      minDurationSec: 0,
      maxDurationSec: 0,
      supportsAudio: false,
      inputTypes: ['text'],
      pricingPerSecUsd: 0,
      pricingPerCallUsd: 0,
      freeTierAvailable: true,
      status: 'active',
    },
    {
      id: 'mod-gemini-tts-lite',
      providerId: 'prov-gemini-core',
      modelId: 'gemini-3.8-flash-lite-tts',
      displayName: 'Gemini 3.8 Flash Lite TTS (EN/HI Voiceover)',
      capabilityType: 'tts',
      supportedResolutions: [],
      native4k: false,
      supportedAspectRatios: ['16:9'],
      minDurationSec: 1,
      maxDurationSec: 120,
      supportsAudio: true,
      inputTypes: ['text'],
      pricingPerSecUsd: 0,
      pricingPerCallUsd: 0,
      freeTierAvailable: true,
      status: 'active',
    },
    {
      id: 'mod-gemini-tts-pro',
      providerId: 'prov-gemini-core',
      modelId: 'gemini-3.8-flash-tts',
      displayName: 'Gemini 3.8 Flash TTS (Dual-Speaker Screenplay)',
      capabilityType: 'tts',
      supportedResolutions: [],
      native4k: false,
      supportedAspectRatios: ['16:9'],
      minDurationSec: 1,
      maxDurationSec: 120,
      supportsAudio: true,
      inputTypes: ['text'],
      pricingPerSecUsd: 0,
      pricingPerCallUsd: 0,
      freeTierAvailable: true,
      status: 'active',
    },
    {
      id: 'mod-gemini-transcribe',
      providerId: 'prov-gemini-core',
      modelId: 'gemini-3.5-transcribe',
      displayName: 'Gemini 3.5 Transcribe (Speech-to-Text)',
      capabilityType: 'stt',
      supportedResolutions: [],
      native4k: false,
      supportedAspectRatios: ['16:9'],
      minDurationSec: 1,
      maxDurationSec: 600,
      supportsAudio: true,
      inputTypes: ['audio', 'video'],
      pricingPerSecUsd: 0,
      pricingPerCallUsd: 0,
      freeTierAvailable: true,
      status: 'active',
    },
    {
      id: 'mod-nano-banana',
      providerId: 'prov-gemini-core',
      modelId: 'gemini-nano-banana-2.1',
      displayName: 'Nano Banana 2.1 (4K Image Studio)',
      capabilityType: 'text_to_image',
      supportedResolutions: ['1K', '2K', '4K'],
      native4k: true,
      supportedAspectRatios: ['16:9', '9:16', '1:1', '4:5'],
      minDurationSec: 0,
      maxDurationSec: 0,
      supportsAudio: false,
      inputTypes: ['text', 'image'],
      pricingPerSecUsd: 0,
      pricingPerCallUsd: 0.04,
      freeTierAvailable: false,
      status: 'requires_paid_key',
    },
    {
      id: 'mod-flash-lite-image',
      providerId: 'prov-gemini-core',
      modelId: 'gemini-3.1-flash-lite-image',
      displayName: 'Gemini 3.1 Flash Lite Image',
      capabilityType: 'text_to_image',
      supportedResolutions: ['1K'],
      native4k: false,
      supportedAspectRatios: ['16:9', '9:16', '1:1', '4:5'],
      minDurationSec: 0,
      maxDurationSec: 0,
      supportsAudio: false,
      inputTypes: ['text', 'image'],
      pricingPerSecUsd: 0,
      pricingPerCallUsd: 0.015,
      freeTierAvailable: false,
      status: 'requires_paid_key',
    },
    {
      id: 'mod-lyria-clip',
      providerId: 'prov-gemini-core',
      modelId: 'lyria-3-clip-preview',
      displayName: 'Lyria 3 Clip (30s AI Soundtrack)',
      capabilityType: 'music',
      supportedResolutions: [],
      native4k: false,
      supportedAspectRatios: ['16:9'],
      minDurationSec: 10,
      maxDurationSec: 30,
      supportsAudio: true,
      inputTypes: ['text', 'image'],
      pricingPerSecUsd: 0,
      pricingPerCallUsd: 0.05,
      freeTierAvailable: false,
      status: 'requires_paid_key',
    },
  ];

  const insertModel = db.prepare(`
    INSERT OR IGNORE INTO ai_models (
      id, provider_id, model_id, display_name, capability_type,
      supported_resolutions_json, native_4k, supported_aspect_ratios_json,
      min_duration_sec, max_duration_sec, supports_audio, input_types_json,
      pricing_per_sec_usd, pricing_per_call_usd, free_tier_available, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const m of models) {
    insertModel.run(
      m.id,
      m.providerId,
      m.modelId,
      m.displayName,
      m.capabilityType,
      JSON.stringify(m.supportedResolutions),
      m.native4k ? 1 : 0,
      JSON.stringify(m.supportedAspectRatios),
      m.minDurationSec,
      m.maxDurationSec,
      m.supportsAudio ? 1 : 0,
      JSON.stringify(m.inputTypes),
      m.pricingPerSecUsd,
      m.pricingPerCallUsd,
      m.freeTierAvailable ? 1 : 0,
      m.status
    );
  }

  // Convert generated starter frames into real MP4 starter clips if not already seeded
  const mediaCount = (db.prepare('SELECT COUNT(*) as c FROM media_assets').get() as { c: number }).c;
  if (mediaCount === 0) {
    const starterSpecs = [
      {
        id: 'asset-starter-cinema',
        title: 'Coastal Electric Coupe (Cinema 1080p)',
        srcRel: 'src/assets/images/studio_hero_cinema_1794989743261.jpg',
        outMp4: 'starter_coastal_coupe.mp4',
        thumb: 'starter_coastal_coupe.jpg',
        width: 1920,
        height: 1080,
        durationSec: 6,
        motion: 'zoom_in' as const,
      },
      {
        id: 'asset-starter-watch',
        title: 'Titanium Chronograph Product Spot',
        srcRel: 'src/assets/images/template_product_watch_1794989744225.jpg',
        outMp4: 'starter_watch_spot.mp4',
        thumb: 'starter_watch_spot.jpg',
        width: 1920,
        height: 1080,
        durationSec: 5,
        motion: 'pan_right' as const,
      },
      {
        id: 'asset-starter-vertical',
        title: 'Architectural Atrium Reel (9:16)',
        srcRel: 'src/assets/images/template_vertical_reel_1794989744860.jpg',
        outMp4: 'starter_atrium_reel.mp4',
        thumb: 'starter_atrium_reel.jpg',
        width: 1080,
        height: 1920,
        durationSec: 5,
        motion: 'zoom_in' as const,
      },
      {
        id: 'asset-starter-animation',
        title: 'Rooftop Observatory Stop-Motion',
        srcRel: 'src/assets/images/template_animation_world_1794989746155.jpg',
        outMp4: 'starter_observatory_anim.mp4',
        thumb: 'starter_observatory_anim.jpg',
        width: 1920,
        height: 1080,
        durationSec: 6,
        motion: 'zoom_out' as const,
      },
    ];

    for (const s of starterSpecs) {
      const srcAbs = path.resolve(process.cwd(), s.srcRel);
      if (!fs.existsSync(srcAbs)) continue;
      const outMp4Abs = path.join(MEDIA_DIR, s.outMp4);
      const outThumbAbs = path.join(THUMB_DIR, s.thumb);
      try {
        if (!fs.existsSync(outMp4Abs)) {
          await createKenBurnsVideo(srcAbs, outMp4Abs, {
            width: s.width,
            height: s.height,
            durationSec: s.durationSec,
            fps: 30,
            motion: s.motion,
          });
        }
        fs.copyFileSync(srcAbs, outThumbAbs);
        const probed = await probeMedia(outMp4Abs);
        db.prepare(`
          INSERT INTO media_assets (
            id, user_id, project_id, kind, title, filename, mime_type, file_path,
            thumbnail_path, duration_sec, width, height, fps, codec, is_native_4k, source_type, metadata_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          s.id,
          'user-studio-admin',
          null,
          'video',
          s.title,
          s.outMp4,
          'video/mp4',
          outMp4Abs,
          outThumbAbs,
          probed.durationSec,
          probed.width,
          probed.height,
          probed.fps,
          probed.codec,
          0,
          'starter',
          JSON.stringify({ starterStill: `/${s.srcRel}` }),
          now
        );
      } catch (err) {
        console.error('Failed creating starter video:', s.id, err);
      }
    }
  }

  // Seed default workspace project if none exists
  const projCount = (db.prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number }).c;
  if (projCount === 0) {
    const defaultTimeline: TimelineState = {
      tracks: [
        { id: 'trk-v1', kind: 'video', name: 'Video 1 (Main)', orderIndex: 0, muted: false, locked: false, volume: 1 },
        { id: 'trk-v2', kind: 'video', name: 'Video 2 (Overlay / PiP)', orderIndex: 1, muted: false, locked: false, volume: 1 },
        { id: 'trk-t1', kind: 'text', name: 'Titles & Subtitles', orderIndex: 2, muted: false, locked: false, volume: 1 },
        { id: 'trk-a1', kind: 'audio', name: 'Audio 1 (Voiceover)', orderIndex: 3, muted: false, locked: false, volume: 1 },
        { id: 'trk-a2', kind: 'audio', name: 'Audio 2 (Music / SFX)', orderIndex: 4, muted: false, locked: false, volume: 0.7 },
      ],
      clips: [
        {
          id: 'clip-starter-1',
          trackId: 'trk-v1',
          mediaId: 'asset-starter-cinema',
          kind: 'video',
          label: 'Coastal Electric Coupe',
          startSec: 0,
          durationSec: 6,
          inSec: 0,
          outSec: 6,
          properties: {
            speed: 1,
            reverse: false,
            opacity: 1,
            brightness: 0,
            contrast: 1.05,
            saturation: 1.08,
            filter: 'cinema_warm',
            transitionIn: 'fade',
            transitionDurationSec: 0.6,
            chromaKeyEnabled: false,
            chromaKeyColor: '#00FF00',
            chromaKeySimilarity: 0.25,
            cropX: 0,
            cropY: 0,
            cropW: 100,
            cropH: 100,
            rotationDeg: 0,
            scale: 1,
            volume: 1,
          },
        },
        {
          id: 'clip-starter-title',
          trackId: 'trk-t1',
          mediaId: null,
          kind: 'text',
          label: 'Opening Title',
          startSec: 0.6,
          durationSec: 4.4,
          inSec: 0,
          outSec: 4.4,
          properties: {
            speed: 1,
            reverse: false,
            opacity: 1,
            brightness: 0,
            contrast: 1,
            saturation: 1,
            filter: 'none',
            transitionIn: 'fade',
            transitionDurationSec: 0.5,
            chromaKeyEnabled: false,
            chromaKeyColor: '#00FF00',
            chromaKeySimilarity: 0.25,
            cropX: 0,
            cropY: 0,
            cropW: 100,
            cropH: 100,
            rotationDeg: 0,
            scale: 1,
            volume: 1,
            textContent: 'HORIZON GT — SILENT VELOCITY',
            textColor: '#FFFFFF',
            fontSize: 48,
            textAnimation: 'fade_up',
            textPosition: 'bottom',
          },
        },
      ],
      subtitles: [],
    };

    saveProjectRecord({
      id: 'proj-coastal-commercial',
      userId: 'user-studio-admin',
      folder: 'Commercials',
      title: 'Horizon GT Coastal Commercial',
      description: 'Anamorphic automotive launch spot ready for 4K mastering and bilingual voiceover.',
      aspectRatio: '16:9',
      targetResolution: '1080p',
      targetFps: 30,
      timeline: defaultTimeline,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export function saveProjectRecord(proj: Project, versionLabel?: string): void {
  const timelineJson = JSON.stringify(proj.timeline);
  const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(proj.id);

  const tx = db.transaction(() => {
    if (existing) {
      db.prepare(`
        UPDATE projects SET
          folder = ?, title = ?, description = ?, aspect_ratio = ?,
          target_resolution = ?, target_fps = ?, timeline_json = ?,
          version = ?, updated_at = ?
        WHERE id = ?
      `).run(
        proj.folder,
        proj.title,
        proj.description,
        proj.aspectRatio,
        proj.targetResolution,
        proj.targetFps,
        timelineJson,
        proj.version,
        proj.updatedAt,
        proj.id
      );
    } else {
      db.prepare(`
        INSERT INTO projects (
          id, user_id, folder, title, description, aspect_ratio,
          target_resolution, target_fps, timeline_json, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        proj.id,
        proj.userId,
        proj.folder,
        proj.title,
        proj.description,
        proj.aspectRatio,
        proj.targetResolution,
        proj.targetFps,
        timelineJson,
        proj.version,
        proj.createdAt,
        proj.updatedAt
      );
    }

    // Sync normalized timeline_tracks and timeline_clips tables
    db.prepare('DELETE FROM timeline_clips WHERE project_id = ?').run(proj.id);
    db.prepare('DELETE FROM timeline_tracks WHERE project_id = ?').run(proj.id);

    const insertTrack = db.prepare(`
      INSERT INTO timeline_tracks (id, project_id, kind, name, order_index, muted, locked, volume)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const trackIds = new Set<string>();
    for (const t of proj.timeline.tracks) {
      trackIds.add(t.id);
      insertTrack.run(
        `${proj.id}:${t.id}`,
        proj.id,
        t.kind,
        t.name,
        t.orderIndex,
        t.muted ? 1 : 0,
        t.locked ? 1 : 0,
        t.volume ?? 1
      );
    }

    const insertClip = db.prepare(`
      INSERT INTO timeline_clips (id, track_id, project_id, media_id, kind, label, start_sec, duration_sec, in_sec, out_sec, properties_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of proj.timeline.clips) {
      if (!trackIds.has(c.trackId)) continue;
      insertClip.run(
        `${proj.id}:${c.id}`,
        `${proj.id}:${c.trackId}`,
        proj.id,
        c.mediaId || null,
        c.kind,
        c.label,
        c.startSec,
        c.durationSec,
        c.inSec,
        c.outSec,
        JSON.stringify(c.properties)
      );
    }

    if (versionLabel) {
      db.prepare(`
        INSERT INTO project_versions (id, project_id, version, label, timeline_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        `ver-${crypto.randomUUID()}`,
        proj.id,
        proj.version,
        versionLabel,
        timelineJson,
        proj.updatedAt
      );
    }
  });

  tx();
}

export function cleanupOldExports(): void {
  const maxHours = Number(process.env.STORAGE_MAX_AGE_HOURS || '72');
  const cutoff = Date.now() - maxHours * 3600 * 1000;
  const rows = db
    .prepare("SELECT id, output_path FROM export_jobs WHERE status = 'completed' AND output_path IS NOT NULL")
    .all() as Array<{ id: string; output_path: string }>;
  for (const row of rows) {
    if (fs.existsSync(row.output_path)) {
      const stat = fs.statSync(row.output_path);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(row.output_path);
      }
    }
  }
}

export function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    folder: String(row.folder),
    title: String(row.title),
    description: String(row.description),
    aspectRatio: row.aspect_ratio as AspectRatio,
    targetResolution: row.target_resolution as Project['targetResolution'],
    targetFps: Number(row.target_fps) as Project['targetFps'],
    timeline: JSON.parse(String(row.timeline_json)) as TimelineState,
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function rowToMediaAsset(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    projectId: row.project_id ? String(row.project_id) : null,
    kind: row.kind as 'video' | 'image' | 'audio',
    title: String(row.title),
    filename: String(row.filename),
    mimeType: String(row.mime_type),
    url: `/api/media/${row.id}/stream`,
    thumbnailUrl: row.thumbnail_path ? `/api/media/${row.id}/thumbnail` : null,
    durationSec: Number(row.duration_sec),
    width: Number(row.width),
    height: Number(row.height),
    fps: Number(row.fps),
    codec: String(row.codec),
    isNative4k: Boolean(row.is_native_4k),
    sourceType: row.source_type as 'upload' | 'starter' | 'ai_generated' | 'ffmpeg_rendered',
    metadata: JSON.parse(String(row.metadata_json || '{}')),
    createdAt: String(row.created_at),
  };
}
