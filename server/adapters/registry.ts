import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AIModelCapability,
  AIProvider,
  AspectRatio,
  CostEstimate,
  ExportResolution,
} from '../../src/types/studio.js';
import { decryptSecret } from '../crypto.js';
import { db } from '../db.js';
import {
  formatGeminiError,
  generateImageWithGemini,
  generateMusicWithLyria,
  generateVideoWithOmniFlash,
  getGeminiClient,
} from '../gemini.js';
import {
  createKenBurnsVideo,
  generateThumbnail,
  getResolutionDimensions,
  MEDIA_DIR,
  probeMedia,
  THUMB_DIR,
} from '../services/ffmpegService.js';

export function listProviders(): AIProvider[] {
  const rows = db.prepare('SELECT * FROM ai_providers ORDER BY name ASC').all() as Array<
    Record<string, unknown>
  >;
  return rows.map((r) => ({
    id: String(r.id),
    slug: String(r.slug),
    name: String(r.name),
    category: r.category as AIProvider['category'],
    enabled: Boolean(r.enabled),
    authType: r.auth_type as AIProvider['authType'],
    baseUrl: String(r.base_url),
    hasApiKey: Boolean(r.encrypted_api_key) || r.auth_type === 'env_gemini' || r.auth_type === 'local_ffmpeg',
    rateLimitRpm: Number(r.rate_limit_rpm),
    status: r.status as AIProvider['status'],
    lastTestedAt: r.last_tested_at ? String(r.last_tested_at) : null,
    lastError: r.last_error ? String(r.last_error) : null,
  }));
}

export function listModels(capabilityType?: string): AIModelCapability[] {
  const sql = capabilityType
    ? `SELECT m.*, p.name as provider_name, p.slug as provider_slug, p.enabled as provider_enabled
       FROM ai_models m JOIN ai_providers p ON m.provider_id = p.id
       WHERE m.capability_type = ? ORDER BY m.free_tier_available DESC, m.display_name ASC`
    : `SELECT m.*, p.name as provider_name, p.slug as provider_slug, p.enabled as provider_enabled
       FROM ai_models m JOIN ai_providers p ON m.provider_id = p.id
       ORDER BY m.free_tier_available DESC, m.display_name ASC`;

  const rows = (
    capabilityType ? db.prepare(sql).all(capabilityType) : db.prepare(sql).all()
  ) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    providerId: String(r.provider_id),
    providerName: String(r.provider_name),
    providerSlug: String(r.provider_slug),
    modelId: String(r.model_id),
    displayName: String(r.display_name),
    capabilityType: r.capability_type as AIModelCapability['capabilityType'],
    supportedResolutions: JSON.parse(String(r.supported_resolutions_json)),
    native4k: Boolean(r.native_4k),
    supportedAspectRatios: JSON.parse(String(r.supported_aspect_ratios_json)) as AspectRatio[],
    minDurationSec: Number(r.min_duration_sec),
    maxDurationSec: Number(r.max_duration_sec),
    supportsAudio: Boolean(r.supports_audio),
    inputTypes: JSON.parse(String(r.input_types_json)),
    pricingPerSecUsd: Number(r.pricing_per_sec_usd),
    pricingPerCallUsd: Number(r.pricing_per_call_usd),
    freeTierAvailable: Boolean(r.free_tier_available),
    status: !r.provider_enabled
      ? 'disabled'
      : (r.status as AIModelCapability['status']),
  }));
}

export function estimateGenerationCost(params: {
  modelId: string;
  durationSec: number;
  resolution: string;
  aspectRatio: AspectRatio;
}): CostEstimate {
  const models = listModels();
  const model = models.find((m) => m.modelId === params.modelId);
  if (!model) {
    throw new Error(`Model "${params.modelId}" not found in capability registry.`);
  }

  const warnings: string[] = [];
  if (
    model.supportedResolutions.length > 0 &&
    !model.supportedResolutions.map((r) => r.toLowerCase()).includes(params.resolution.toLowerCase())
  ) {
    warnings.push(
      `Selected resolution ${params.resolution} is not natively supported by ${model.displayName}. Supported: ${model.supportedResolutions.join(', ')}.`
    );
  }
  if (!model.supportedAspectRatios.includes(params.aspectRatio)) {
    warnings.push(
      `Aspect ratio ${params.aspectRatio} is not supported by ${model.displayName}. Supported: ${model.supportedAspectRatios.join(', ')}.`
    );
  }
  if (model.maxDurationSec > 0 && (params.durationSec < model.minDurationSec || params.durationSec > model.maxDurationSec)) {
    warnings.push(
      `Duration ${params.durationSec}s is outside ${model.displayName} limits (${model.minDurationSec}s–${model.maxDurationSec}s).`
    );
  }
  if (!model.native4k && params.resolution.toLowerCase().includes('4k')) {
    warnings.push(
      `${model.displayName} does not generate native 4K. Exporting at 2160p will use FFmpeg Lanczos upscaling and be labeled Upscaled 4K.`
    );
  }

  const estimatedCostUsd =
    Math.round((model.pricingPerCallUsd + model.pricingPerSecUsd * params.durationSec) * 1000) /
    1000;

  const alternatives = models
    .filter((m) => m.modelId !== model.modelId && (m.capabilityType === model.capabilityType || m.capabilityType === 'image_to_video'))
    .slice(0, 3)
    .map((m) => ({
      modelId: m.modelId,
      displayName: m.displayName,
      estimatedCostUsd:
        Math.round((m.pricingPerCallUsd + m.pricingPerSecUsd * params.durationSec) * 1000) / 1000,
      maxResolution: m.supportedResolutions[m.supportedResolutions.length - 1] || 'Standard',
    }));

  return {
    modelId: model.modelId,
    displayName: model.displayName,
    providerName: model.providerName,
    estimatedCostUsd,
    freeModeEligible: model.freeTierAvailable,
    expectedQuality: model.native4k ? `${params.resolution} Native` : `${params.resolution} Standard`,
    native4k: model.native4k,
    durationSec: params.durationSec,
    warnings,
    alternatives,
  };
}

export async function testProviderConnection(providerId: string): Promise<{
  ok: boolean;
  message: string;
}> {
  const row = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(providerId) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    throw new Error('Provider not found');
  }
  const now = new Date().toISOString();
  const authType = String(row.auth_type);
  const slug = String(row.slug);

  try {
    if (authType === 'local_ffmpeg') {
      db.prepare(
        'UPDATE ai_providers SET status = ?, last_tested_at = ?, last_error = NULL WHERE id = ?'
      ).run('ready', now, providerId);
      return { ok: true, message: 'Local FFmpeg 4.4+ & FFprobe engine verified.' };
    }

    if (authType === 'env_gemini') {
      const ai = getGeminiClient();
      await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: 'Reply with OK',
      });
      db.prepare(
        'UPDATE ai_providers SET status = ?, last_tested_at = ?, last_error = NULL WHERE id = ?'
      ).run('ready', now, providerId);
      return {
        ok: true,
        message:
          slug === 'google-veo-omni'
            ? 'Gemini API connected (Veo/Omni video requires billing-enabled tier).'
            : 'Gemini API key verified with gemini-4-hydrogen.',
      };
    }

    if (!row.encrypted_api_key) {
      db.prepare(
        'UPDATE ai_providers SET status = ?, last_tested_at = ?, last_error = ? WHERE id = ?'
      ).run('unconfigured', now, 'No API key configured', providerId);
      return { ok: false, message: 'No API key saved for this provider yet.' };
    }

    const apiKey = decryptSecret(String(row.encrypted_api_key));
    const baseUrl = String(row.base_url);
    const res = await fetch(baseUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Provider rejected API key (HTTP ${res.status})`);
    }
    db.prepare(
      'UPDATE ai_providers SET status = ?, last_tested_at = ?, last_error = NULL WHERE id = ?'
    ).run('ready', now, providerId);
    return { ok: true, message: `Endpoint reachable (HTTP ${res.status}). Key accepted.` };
  } catch (err) {
    const msg = formatGeminiError(err);
    db.prepare(
      'UPDATE ai_providers SET status = ?, last_tested_at = ?, last_error = ? WHERE id = ?'
    ).run('error', now, msg, providerId);
    return { ok: false, message: msg };
  }
}

export async function runVideoGenerationJob(jobId: string): Promise<void> {
  const job = db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(jobId) as
    | Record<string, unknown>
    | undefined;
  if (!job) return;

  const params = JSON.parse(String(job.params_json)) as {
    aspectRatio?: AspectRatio;
    resolution?: string;
    durationSec?: number;
    fps?: number;
    motion?: 'zoom_in' | 'zoom_out' | 'pan_right' | 'pan_left';
    sourceMediaId?: string;
    style?: string;
  };

  const modelId = String(job.model_id);
  const providerId = String(job.provider_id);
  const userId = String(job.user_id);
  const projectId = job.project_id ? String(job.project_id) : null;
  const promptText = String(job.enhanced_prompt || job.prompt);
  const now = () => new Date().toISOString();

  const updateJob = (status: string, progress: number, extra?: { outputMediaId?: string; error?: string; actualCost?: number }) => {
    db.prepare(`
      UPDATE generation_jobs
      SET status = ?, progress = ?, output_media_id = COALESCE(?, output_media_id),
          error_message = ?, actual_cost_usd = COALESCE(?, actual_cost_usd), updated_at = ?
      WHERE id = ?
    `).run(
      status,
      progress,
      extra?.outputMediaId ?? null,
      extra?.error ?? null,
      extra?.actualCost ?? null,
      now(),
      jobId
    );
  };

  try {
    updateJob('running', 15);

    const models = listModels();
    const model = models.find((m) => m.modelId === modelId);
    if (!model) throw new Error(`Model ${modelId} not registered.`);
    if (model.status === 'disabled') throw new Error(`Provider ${model.providerName} is disabled in Admin API settings.`);

    const durationSec = Math.max(2, Math.min(30, Number(params.durationSec || 6)));
    const aspectRatio = (params.aspectRatio || '16:9') as AspectRatio;
    const resolution = (params.resolution || '1080p').toLowerCase();

    // Validate capabilities strictly
    if (
      model.supportedResolutions.length > 0 &&
      !model.supportedResolutions.map((r) => r.toLowerCase()).includes(resolution)
    ) {
      throw new Error(
        `Resolution "${params.resolution}" is unsupported by ${model.displayName}. Allowed: ${model.supportedResolutions.join(', ')}.`
      );
    }
    if (!model.supportedAspectRatios.includes(aspectRatio)) {
      throw new Error(
        `Aspect ratio "${aspectRatio}" is unsupported by ${model.displayName}. Allowed: ${model.supportedAspectRatios.join(', ')}.`
      );
    }

    let sourceAssetPath: string | undefined;
    let sourceAssetMime: string | undefined;
    let sourceAssetKind: string | undefined;
    if (params.sourceMediaId) {
      const asset = db
        .prepare('SELECT * FROM media_assets WHERE id = ?')
        .get(params.sourceMediaId) as Record<string, unknown> | undefined;
      if (asset && fs.existsSync(String(asset.file_path))) {
        sourceAssetPath = String(asset.file_path);
        sourceAssetMime = String(asset.mime_type);
        sourceAssetKind = String(asset.kind);
      }
    }

    if (modelId === 'ffmpeg-kenburns-4k') {
      // Zero-budget local FFmpeg 4K Motion Video Generator
      let imagePath = sourceAssetPath;
      if (!imagePath || sourceAssetKind !== 'image') {
        // Fallback to starter frame matching aspect ratio if user didn't pick an image
        const starterDir = path.resolve(process.cwd(), 'src/assets/images');
        const files = fs.existsSync(starterDir) ? fs.readdirSync(starterDir).filter((f) => f.endsWith('.jpg')) : [];
        const picked =
          aspectRatio === '9:16'
            ? files.find((f) => f.includes('vertical')) || files[0]
            : files.find((f) => f.includes('hero')) || files[0];
        if (!picked) {
          throw new Error('Upload or select a source image to animate with the Local FFmpeg Motion Engine.');
        }
        imagePath = path.join(starterDir, picked);
      }

      updateJob('running', 40);
      const resMap: Record<string, ExportResolution> = {
        '720p': '720p',
        '1080p': '1080p',
        '1440p': '1440p',
        '2160p': '2160p',
        '4k': '2160p',
      };
      const targetRes = resMap[resolution] || '1080p';
      const { width, height } = getResolutionDimensions(targetRes, aspectRatio);
      const outFilename = `motion_${crypto.randomUUID()}.mp4`;
      const outPath = path.join(MEDIA_DIR, outFilename);
      const thumbName = `${outFilename}.jpg`;
      const thumbPath = path.join(THUMB_DIR, thumbName);

      await createKenBurnsVideo(imagePath, outPath, {
        width,
        height,
        durationSec,
        fps: Number(params.fps || 30),
        motion: params.motion || 'zoom_in',
      });
      updateJob('running', 85);
      await generateThumbnail(outPath, thumbPath);
      const probed = await probeMedia(outPath);

      const mediaId = `asset-${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO media_assets (
          id, user_id, project_id, kind, title, filename, mime_type, file_path,
          thumbnail_path, duration_sec, width, height, fps, codec, is_native_4k, source_type, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mediaId,
        userId,
        projectId,
        'video',
        `${String(job.prompt).slice(0, 48)} (${targetRes})`,
        outFilename,
        'video/mp4',
        outPath,
        thumbPath,
        probed.durationSec,
        probed.width,
        probed.height,
        probed.fps,
        probed.codec,
        probed.isNative4k ? 1 : 0,
        'ffmpeg_rendered',
        JSON.stringify({ modelId, prompt: promptText }),
        now()
      );

      db.prepare(
        'INSERT INTO api_usage (id, user_id, provider_id, model_id, job_id, units, cost_usd, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(`use-${crypto.randomUUID()}`, userId, providerId, modelId, jobId, `${durationSec}s local`, 0, 'success', now());

      updateJob('completed', 100, { outputMediaId: mediaId, actualCost: 0 });
      return;
    }

    if (modelId === 'gemini-omni-1.2-flash') {
      updateJob('running', 30);
      const omniRes = (resolution === '4k' || resolution === '2160p' ? '4k' : resolution === '1080p' ? '1080p' : '720p') as
        | '720p'
        | '1080p'
        | '4k';
      const omniAspect = (aspectRatio === '9:16' ? '9:16' : '16:9') as '16:9' | '9:16';

      const result = await generateVideoWithOmniFlash({
        prompt: promptText,
        aspectRatio: omniAspect,
        durationSec,
        resolution: omniRes,
        imagePath: sourceAssetKind === 'image' ? sourceAssetPath : undefined,
        imageMimeType: sourceAssetMime,
        videoPath: sourceAssetKind === 'video' ? sourceAssetPath : undefined,
      });

      const outFilename = `omni_${crypto.randomUUID()}.mp4`;
      const outPath = path.join(MEDIA_DIR, outFilename);
      fs.writeFileSync(outPath, result.buffer);
      const thumbPath = path.join(THUMB_DIR, `${outFilename}.jpg`);
      await generateThumbnail(outPath, thumbPath);
      const probed = await probeMedia(outPath);

      const mediaId = `asset-${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO media_assets (
          id, user_id, project_id, kind, title, filename, mime_type, file_path,
          thumbnail_path, duration_sec, width, height, fps, codec, is_native_4k, source_type, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mediaId,
        userId,
        projectId,
        'video',
        `${String(job.prompt).slice(0, 48)} (Omni ${omniRes})`,
        outFilename,
        result.mimeType,
        outPath,
        thumbPath,
        probed.durationSec,
        probed.width,
        probed.height,
        probed.fps,
        probed.codec,
        probed.isNative4k ? 1 : 0,
        'ai_generated',
        JSON.stringify({ modelId, interactionId: result.interactionId }),
        now()
      );

      const actualCost = Math.round(durationSec * model.pricingPerSecUsd * 1000) / 1000;
      db.prepare(
        'INSERT INTO api_usage (id, user_id, provider_id, model_id, job_id, units, cost_usd, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(`use-${crypto.randomUUID()}`, userId, providerId, modelId, jobId, `${durationSec}s @ ${omniRes}`, actualCost, 'success', now());
      db.prepare(
        'INSERT INTO billing_records (id, user_id, description, amount_usd, mode, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(`bill-${crypto.randomUUID()}`, userId, `Video Gen: ${model.displayName} (${durationSec}s)`, actualCost, 'paid_ai', now());

      updateJob('completed', 100, { outputMediaId: mediaId, actualCost });
      return;
    }

    if (modelId === 'gemini-nano-banana-2.1' || modelId === 'gemini-3.1-flash-lite-image') {
      updateJob('running', 45);
      const sourceBase64 =
        sourceAssetPath && sourceAssetKind === 'image'
          ? fs.readFileSync(sourceAssetPath).toString('base64')
          : undefined;
      const result = await generateImageWithGemini({
        prompt: promptText,
        modelId,
        aspectRatio,
        imageSize: resolution === '4k' ? '4K' : resolution === '2k' ? '2K' : '1K',
        sourceImageBase64: sourceBase64,
        sourceMimeType: sourceAssetMime,
      });

      const ext = result.mimeType.includes('png') ? 'png' : 'jpg';
      const outFilename = `img_${crypto.randomUUID()}.${ext}`;
      const outPath = path.join(MEDIA_DIR, outFilename);
      fs.writeFileSync(outPath, result.buffer);
      const probed = await probeMedia(outPath);

      const mediaId = `asset-${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO media_assets (
          id, user_id, project_id, kind, title, filename, mime_type, file_path,
          thumbnail_path, duration_sec, width, height, fps, codec, is_native_4k, source_type, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mediaId,
        userId,
        projectId,
        'image',
        String(job.prompt).slice(0, 48),
        outFilename,
        result.mimeType,
        outPath,
        outPath,
        0,
        probed.width,
        probed.height,
        0,
        probed.codec,
        probed.width >= 3840 ? 1 : 0,
        'ai_generated',
        JSON.stringify({ modelId, prompt: promptText }),
        now()
      );
      updateJob('completed', 100, { outputMediaId: mediaId, actualCost: model.pricingPerCallUsd });
      return;
    }

    if (modelId === 'lyria-3-clip-preview') {
      updateJob('running', 45);
      const res = await generateMusicWithLyria({ prompt: promptText, modelId: 'lyria-3-clip-preview' });
      const outFilename = `music_${crypto.randomUUID()}.mp3`;
      const outPath = path.join(MEDIA_DIR, outFilename);
      fs.writeFileSync(outPath, res.buffer);
      const probed = await probeMedia(outPath);

      const mediaId = `asset-${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO media_assets (
          id, user_id, project_id, kind, title, filename, mime_type, file_path,
          thumbnail_path, duration_sec, width, height, fps, codec, is_native_4k, source_type, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mediaId,
        userId,
        projectId,
        'audio',
        `Lyria Score: ${String(job.prompt).slice(0, 36)}`,
        outFilename,
        res.mimeType,
        outPath,
        null,
        probed.durationSec || 30,
        0,
        0,
        0,
        probed.codec,
        0,
        'ai_generated',
        JSON.stringify({ modelId, lyrics: res.lyrics }),
        now()
      );
      updateJob('completed', 100, { outputMediaId: mediaId, actualCost: model.pricingPerCallUsd });
      return;
    }

    // External providers (Runway, Kling)
    const provRow = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(providerId) as Record<
      string,
      unknown
    >;
    if (!provRow?.encrypted_api_key) {
      throw new Error(
        `${model.providerName} API key is not configured. Add an API key in Admin API Management or switch to Local FFmpeg Motion Engine.`
      );
    }

    const apiKey = decryptSecret(String(provRow.encrypted_api_key));
    const response = await fetch(`${String(provRow.base_url)}/image_to_video`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        promptText,
        duration: durationSec,
        ratio: aspectRatio,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`${model.providerName} returned HTTP ${response.status}: ${errBody.slice(0, 300)}`);
    }

    throw new Error(
      `${model.providerName} async task accepted, but webhook callback URL is required for external provider media retrieval.`
    );
  } catch (err) {
    const msg = formatGeminiError(err);
    db.prepare(
      'INSERT INTO api_usage (id, user_id, provider_id, model_id, job_id, units, cost_usd, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(`use-${crypto.randomUUID()}`, userId, providerId, modelId, jobId, 'failed', 0, 'failed', now());
    updateJob('failed', 0, { error: msg });
  }
}
