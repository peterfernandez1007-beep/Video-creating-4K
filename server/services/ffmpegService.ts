import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  AspectRatio,
  ExportCodec,
  ExportFormat,
  ExportResolution,
  MediaAsset,
  TimelineClip,
  TimelineState,
} from '../../src/types/studio.js';

const execFileAsync = promisify(execFile);

export const STORAGE_ROOT = path.resolve(process.cwd(), 'storage');
export const MEDIA_DIR = path.join(STORAGE_ROOT, 'media');
export const THUMB_DIR = path.join(STORAGE_ROOT, 'thumbnails');
export const EXPORT_DIR = path.join(STORAGE_ROOT, 'exports');
export const TEMP_DIR = path.join(STORAGE_ROOT, 'temp');

for (const dir of [STORAGE_ROOT, MEDIA_DIR, THUMB_DIR, EXPORT_DIR, TEMP_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const DEFAULT_FONT_PATH = fs.existsSync(
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'
)
  ? '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'
  : '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

export interface ProbeResult {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  codec: string;
  hasAudio: boolean;
  isNative4k: boolean;
}

export function getResolutionDimensions(
  resolution: ExportResolution,
  aspectRatio: AspectRatio
): { width: number; height: number } {
  const longEdgeMap: Record<ExportResolution, number> = {
    '720p': 1280,
    '1080p': 1920,
    '1440p': 2560,
    '2160p': 3840,
  };
  const baseHeightMap: Record<ExportResolution, number> = {
    '720p': 720,
    '1080p': 1080,
    '1440p': 1440,
    '2160p': 2160,
  };

  const longEdge = longEdgeMap[resolution];
  const shortH = baseHeightMap[resolution];

  const makeEven = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

  switch (aspectRatio) {
    case '16:9':
      return { width: longEdge, height: shortH };
    case '9:16':
      return { width: shortH, height: longEdge };
    case '1:1':
      return { width: shortH, height: shortH };
    case '4:5':
      return { width: makeEven((shortH * 4) / 5), height: shortH };
    case '21:9':
      return { width: longEdge, height: makeEven((longEdge * 9) / 21) };
    default:
      return { width: longEdge, height: shortH };
  }
}

export function classifyExportQuality(
  targetResolution: ExportResolution,
  sourceAssets: MediaAsset[]
): 'native_4k' | 'upscaled_4k' | 'native_hd' | 'upscaled' {
  const visualAssets = sourceAssets.filter((a) => a.kind === 'video' || a.kind === 'image');
  if (visualAssets.length === 0) {
    return targetResolution === '2160p' ? 'native_4k' : 'native_hd';
  }
  const allNative4k = visualAssets.every((a) => a.width >= 3840 || a.height >= 2160);
  const { width, height } = getResolutionDimensions(targetResolution, '16:9');
  const maxTarget = Math.max(width, height);
  const anyBelowTarget = visualAssets.some((a) => Math.max(a.width, a.height) < maxTarget);

  if (targetResolution === '2160p') {
    return allNative4k ? 'native_4k' : 'upscaled_4k';
  }
  return anyBelowTarget ? 'upscaled' : 'native_hd';
}

export async function probeMedia(filePath: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      duration?: string;
    }>;
  };

  const videoStream = parsed.streams?.find((s) => s.codec_type === 'video');
  const audioStream = parsed.streams?.find((s) => s.codec_type === 'audio');

  let fps = 30;
  if (videoStream?.r_frame_rate && videoStream.r_frame_rate.includes('/')) {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
    if (den && den > 0) {
      fps = Math.round((num / den) * 100) / 100;
    }
  }

  const width = videoStream?.width ?? 0;
  const height = videoStream?.height ?? 0;
  const durationSec = Number(parsed.format?.duration ?? videoStream?.duration ?? 0) || 0;
  const codec = videoStream?.codec_name ?? audioStream?.codec_name ?? 'unknown';

  return {
    width,
    height,
    fps,
    durationSec,
    codec,
    hasAudio: Boolean(audioStream),
    isNative4k: width >= 3840 || height >= 2160,
  };
}

export async function generateThumbnail(filePath: string, outPath: string): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-ss',
    '00:00:00.5',
    '-i',
    filePath,
    '-frames:v',
    '1',
    '-vf',
    'scale=640:-2',
    outPath,
  ]);
}

export async function createKenBurnsVideo(
  imagePath: string,
  outPath: string,
  opts: {
    width: number;
    height: number;
    durationSec: number;
    fps: number;
    motion: 'zoom_in' | 'zoom_out' | 'pan_right' | 'pan_left';
  }
): Promise<void> {
  const frames = Math.max(24, Math.round(opts.durationSec * opts.fps));
  const scaleUpW = opts.width * 2;
  const scaleUpH = opts.height * 2;
  let zoomExpr = "min(zoom+0.0012,1.25)";
  let xExpr = "iw/2-(iw/zoom/2)";
  let yExpr = "ih/2-(ih/zoom/2)";

  if (opts.motion === 'zoom_out') {
    zoomExpr = "if(eq(on,1),1.25,max(1.0,zoom-0.0012))";
  } else if (opts.motion === 'pan_right') {
    zoomExpr = "1.15";
    xExpr = `if(eq(on,1),0,min(iw-iw/zoom,x+((iw-iw/zoom)/${frames})))`;
  } else if (opts.motion === 'pan_left') {
    zoomExpr = "1.15";
    xExpr = `if(eq(on,1),iw-iw/zoom,max(0,x-((iw-iw/zoom)/${frames})))`;
  }

  const vf = [
    `scale=${scaleUpW}:${scaleUpH}:force_original_aspect_ratio=increase`,
    `crop=${scaleUpW}:${scaleUpH}`,
    `zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=${frames}:s=${opts.width}x${opts.height}:fps=${opts.fps}`,
    'format=yuv420p',
  ].join(',');

  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-loop',
      '1',
      '-i',
      imagePath,
      '-f',
      'lavfi',
      '-i',
      `anullsrc=channel_layout=stereo:sample_rate=48000`,
      '-t',
      String(opts.durationSec),
      '-vf',
      vf,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-shortest',
      outPath,
    ],
    { timeout: 180000 }
  );
}

export async function processAiVideoTool(
  inputPath: string,
  outPath: string,
  tool: 'upscale_4k' | 'enhance' | 'denoise_video' | 'denoise_audio' | 'chroma_key',
  params?: { chromaColor?: string; similarity?: number }
): Promise<void> {
  if (tool === 'denoise_audio') {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      inputPath,
      '-af',
      'highpass=f=80,lowpass=f=12000,afftdn=nf=-25',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      outPath,
    ]);
    return;
  }

  let vf = 'hqdn3d=3:2:4:3,unsharp=5:5:0.8:3:3:0.4,eq=contrast=1.06:saturation=1.08';
  if (tool === 'upscale_4k') {
    vf = 'scale=3840:2160:flags=lanczos,unsharp=5:5:0.6:3:3:0.3';
  } else if (tool === 'denoise_video') {
    vf = 'hqdn3d=6:4:8:6';
  } else if (tool === 'chroma_key') {
    const color = (params?.chromaColor || '0x00FF00').replace('#', '0x');
    const sim = params?.similarity ?? 0.25;
    vf = `format=rgba,colorkey=${color}:${sim}:0.1,format=yuv420p`;
  }

  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-i',
      inputPath,
      '-vf',
      vf,
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '18',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      outPath,
    ],
    { timeout: 300000 }
  );
}

export async function detectScenesWithFfmpeg(inputPath: string): Promise<number[]> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', [
      '-i',
      inputPath,
      '-vf',
      "select='gt(scene,0.3)',showinfo",
      '-f',
      'null',
      '-',
    ]);
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('close', () => {
      const timestamps: number[] = [0];
      const regex = /pts_time:([\d.]+)/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(stderr)) !== null) {
        const t = Math.round(Number(match[1]) * 100) / 100;
        if (!Number.isNaN(t) && t > 0.2) {
          timestamps.push(t);
        }
      }
      resolve(Array.from(new Set(timestamps)).slice(0, 40));
    });
  });
}

export async function extractAudioWav(inputPath: string, outWavPath: string): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    outWavPath,
  ]);
}

function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\n/g, ' ');
}

function buildClipFilterChain(
  clip: TimelineClip,
  targetW: number,
  targetH: number,
  isOverlay: boolean
): string {
  const p = clip.properties;
  const filters: string[] = [];

  if (clip.kind === 'video') {
    filters.push(`trim=start=${clip.inSec.toFixed(3)}:end=${clip.outSec.toFixed(3)}`);
    filters.push('setpts=PTS-STARTPTS');
    if (p.reverse) {
      filters.push('reverse');
    }
    const speed = Math.min(4, Math.max(0.25, p.speed || 1));
    if (Math.abs(speed - 1) > 0.01) {
      filters.push(`setpts=${(1 / speed).toFixed(4)}*PTS`);
    }
  } else {
    // image stream looped
    filters.push(`trim=duration=${clip.durationSec.toFixed(3)}`);
    filters.push('setpts=PTS-STARTPTS');
  }

  // Rotation
  if (p.rotationDeg && Math.abs(p.rotationDeg) > 0.1) {
    const rad = (p.rotationDeg * Math.PI) / 180;
    filters.push(`rotate=${rad.toFixed(4)}:fillcolor=black@0`);
  }

  // Scale & fit into canvas with optional scale zoom
  const zoom = Math.min(3, Math.max(0.2, p.scale || 1));
  const scaledW = Math.max(2, Math.floor((targetW * zoom) / 2) * 2);
  const scaledH = Math.max(2, Math.floor((targetH * zoom) / 2) * 2);
  filters.push(`scale=${scaledW}:${scaledH}:force_original_aspect_ratio=decrease`);
  if (zoom > 1.01) {
    filters.push(`crop=${targetW}:${targetH}`);
  } else {
    filters.push(
      `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:color=#090A0F`
    );
  }

  // Color grading & filters
  const brightness = Math.min(0.5, Math.max(-0.5, p.brightness || 0));
  const contrast = Math.min(2, Math.max(0.5, p.contrast || 1));
  const saturation =
    p.filter === 'noir_bw' ? 0 : Math.min(2, Math.max(0, p.saturation ?? 1));

  filters.push(
    `eq=brightness=${brightness.toFixed(2)}:contrast=${contrast.toFixed(2)}:saturation=${saturation.toFixed(2)}`
  );

  if (p.filter === 'cinema_warm') {
    filters.push('colorbalance=rs=0.08:gs=0.02:bs=-0.08');
  } else if (p.filter === 'teal_orange') {
    filters.push('colorbalance=rs=0.12:gs=-0.02:bs=-0.12:rm=0.05:bm=0.08');
  } else if (p.filter === 'vintage') {
    filters.push('curves=vintage');
  }

  // Alpha / Chroma key / Transitions
  if (isOverlay || p.chromaKeyEnabled || p.opacity < 0.99 || p.transitionIn === 'fade' || p.transitionIn === 'crossfade') {
    filters.push('format=yuva420p');
    if (p.chromaKeyEnabled && p.chromaKeyColor) {
      const hex = p.chromaKeyColor.replace('#', '0x');
      const sim = Math.min(0.8, Math.max(0.05, p.chromaKeySimilarity || 0.25));
      filters.push(`colorkey=${hex}:${sim}:0.1`);
    }
    if (p.opacity < 0.99) {
      filters.push(`colorchannelmixer=aa=${Math.max(0.05, p.opacity).toFixed(2)}`);
    }
    if (p.transitionIn === 'fade' || p.transitionIn === 'crossfade') {
      const fd = Math.min(clip.durationSec / 2, p.transitionDurationSec || 0.6);
      filters.push(`fade=t=in:st=0:d=${fd.toFixed(2)}:alpha=1`);
    }
  } else {
    filters.push('format=yuv420p');
  }

  filters.push(`setpts=PTS-STARTPTS+${clip.startSec.toFixed(3)}/TB`);
  return filters.join(',');
}

export async function renderTimelineExport(opts: {
  timeline: TimelineState;
  mediaMap: Map<string, MediaAsset & { absPath: string }>;
  resolution: ExportResolution;
  aspectRatio: AspectRatio;
  fps: number;
  format: ExportFormat;
  codec: ExportCodec;
  outPath: string;
  onProgress: (pct: number) => void;
}): Promise<ProbeResult> {
  const { width, height } = getResolutionDimensions(opts.resolution, opts.aspectRatio);
  const allClips = opts.timeline.clips;

  const totalDuration = Math.max(
    2,
    Math.min(
      300,
      allClips.reduce((max, c) => Math.max(max, c.startSec + c.durationSec), 0)
    )
  );

  const trackOrder = new Map<string, number>();
  for (const t of opts.timeline.tracks) {
    trackOrder.set(t.id, t.orderIndex);
  }
  const mutedTracks = new Set(opts.timeline.tracks.filter((t) => t.muted).map((t) => t.id));

  const visualClips = allClips
    .filter((c) => (c.kind === 'video' || c.kind === 'image') && c.mediaId && opts.mediaMap.has(c.mediaId))
    .sort((a, b) => (trackOrder.get(a.trackId) ?? 0) - (trackOrder.get(b.trackId) ?? 0));

  const textClips = allClips.filter((c) => c.kind === 'text' && c.properties.textContent);
  const audioClips = allClips.filter(
    (c) =>
      !mutedTracks.has(c.trackId) &&
      ((c.kind === 'audio' && c.mediaId && opts.mediaMap.has(c.mediaId)) ||
        (c.kind === 'video' && c.mediaId && opts.mediaMap.get(c.mediaId)?.fps !== undefined && !c.properties.reverse))
  );

  const args: string[] = ['-y'];
  // Input 0: base canvas + silent base audio
  args.push(
    '-f',
    'lavfi',
    '-i',
    `color=c=#090A0F:s=${width}x${height}:r=${opts.fps}:d=${totalDuration.toFixed(3)}`
  );
  args.push(
    '-f',
    'lavfi',
    '-i',
    `anullsrc=channel_layout=stereo:sample_rate=48000:d=${totalDuration.toFixed(3)}`
  );

  let inputIdx = 2;
  const visualInputs: Array<{ idx: number; clip: TimelineClip; isOverlay: boolean }> = [];
  for (let i = 0; i < visualClips.length; i++) {
    const clip = visualClips[i];
    const asset = opts.mediaMap.get(clip.mediaId!)!;
    if (clip.kind === 'image') {
      args.push('-loop', '1', '-t', String(clip.durationSec + 0.2), '-i', asset.absPath);
    } else {
      args.push('-i', asset.absPath);
    }
    const isOverlay = (trackOrder.get(clip.trackId) ?? 0) > 0;
    visualInputs.push({ idx: inputIdx++, clip, isOverlay });
  }

  const audioInputs: Array<{ idx: number; clip: TimelineClip }> = [];
  for (const clip of audioClips) {
    const asset = opts.mediaMap.get(clip.mediaId!)!;
    // Check if asset actually has an audio stream before trying to map :a
    try {
      const probed = await probeMedia(asset.absPath);
      if (!probed.hasAudio) continue;
    } catch {
      continue;
    }
    args.push('-i', asset.absPath);
    audioInputs.push({ idx: inputIdx++, clip });
  }

  const filterParts: string[] = [];
  let currentVideoLabel = '[0:v]';

  for (let i = 0; i < visualInputs.length; i++) {
    const { idx, clip, isOverlay } = visualInputs[i];
    const segLabel = `[vseg${i}]`;
    const nextLabel = `[vcomp${i}]`;
    const chain = buildClipFilterChain(clip, width, height, isOverlay);
    filterParts.push(`[${idx}:v]${chain}${segLabel}`);
    const endSec = (clip.startSec + clip.durationSec).toFixed(3);
    filterParts.push(
      `${currentVideoLabel}${segLabel}overlay=0:0:enable='between(t,${clip.startSec.toFixed(3)},${endSec})':eof_action=pass${nextLabel}`
    );
    currentVideoLabel = nextLabel;
  }

  // Burn text clips & subtitles
  const drawTextFilters: string[] = [];
  for (const tClip of textClips) {
    const txt = escapeDrawtext(tClip.properties.textContent || '');
    if (!txt) continue;
    const size = Math.max(18, Math.round(((tClip.properties.fontSize || 42) * height) / 1080));
    const color = (tClip.properties.textColor || '#FFFFFF').replace('#', '0x');
    const yExpr =
      tClip.properties.textPosition === 'top'
        ? 'h*0.12'
        : tClip.properties.textPosition === 'center'
          ? '(h-text_h)/2'
          : 'h*0.82-text_h';
    const st = tClip.startSec.toFixed(3);
    const en = (tClip.startSec + tClip.durationSec).toFixed(3);
    drawTextFilters.push(
      `drawtext=fontfile='${DEFAULT_FONT_PATH}':text='${txt}':fontsize=${size}:fontcolor=${color}:box=1:boxcolor=black@0.55:boxborderw=12:x=(w-text_w)/2:y=${yExpr}:enable='between(t,${st},${en})'`
    );
  }

  for (const cue of opts.timeline.subtitles ?? []) {
    const txt = escapeDrawtext(cue.text);
    if (!txt) continue;
    const size = Math.max(20, Math.round((34 * height) / 1080));
    drawTextFilters.push(
      `drawtext=fontfile='${DEFAULT_FONT_PATH}':text='${txt}':fontsize=${size}:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=10:x=(w-text_w)/2:y=h*0.88-text_h:enable='between(t,${cue.startSec.toFixed(3)},${cue.endSec.toFixed(3)})'`
    );
  }

  if (drawTextFilters.length > 0) {
    filterParts.push(`${currentVideoLabel}${drawTextFilters.join(',')},format=yuv420p[vfinal]`);
    currentVideoLabel = '[vfinal]';
  } else if (currentVideoLabel === '[0:v]') {
    filterParts.push('[0:v]format=yuv420p[vfinal]');
    currentVideoLabel = '[vfinal]';
  } else {
    filterParts.push(`${currentVideoLabel}format=yuv420p[vfinal]`);
    currentVideoLabel = '[vfinal]';
  }

  // Audio mixing
  let currentAudioLabel = '[1:a]';
  if (audioInputs.length > 0) {
    const mixLabels = ['[1:a]'];
    for (let i = 0; i < audioInputs.length; i++) {
      const { idx, clip } = audioInputs[i];
      const aLabel = `[aseg${i}]`;
      const delayMs = Math.max(0, Math.round(clip.startSec * 1000));
      const vol = Math.min(2, Math.max(0, clip.properties.volume ?? 1));
      const speed = Math.min(2, Math.max(0.5, clip.properties.speed || 1));
      const atempo = Math.abs(speed - 1) > 0.01 ? `,atempo=${speed.toFixed(2)}` : '';
      filterParts.push(
        `[${idx}:a]atrim=start=${clip.inSec.toFixed(3)}:end=${clip.outSec.toFixed(3)},asetpts=PTS-STARTPTS${atempo},volume=${vol.toFixed(2)},adelay=${delayMs}|${delayMs}${aLabel}`
      );
      mixLabels.push(aLabel);
    }
    filterParts.push(
      `${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=2[afinal]`
    );
    currentAudioLabel = '[afinal]';
  }

  args.push('-filter_complex', filterParts.join(';'));
  args.push('-map', currentVideoLabel, '-map', currentAudioLabel);
  args.push('-t', totalDuration.toFixed(3));
  args.push('-r', String(opts.fps));

  if (opts.format === 'webm') {
    args.push('-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0', '-c:a', 'libopus', '-b:a', '128k');
  } else if (opts.codec === 'h265') {
    args.push(
      '-c:v',
      'libx265',
      '-preset',
      'fast',
      '-crf',
      '23',
      '-tag:v',
      'hvc1',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart'
    );
  } else {
    args.push(
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '19',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart'
    );
  }

  args.push(opts.outPath);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderrTail = '';
    proc.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      stderrTail = (stderrTail + s).slice(-2500);
      const timeMatch = s.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
      if (timeMatch) {
        const secs =
          Number(timeMatch[1]) * 3600 + Number(timeMatch[2]) * 60 + Number(timeMatch[3]);
        const pct = Math.min(95, Math.max(5, Math.round((secs / totalDuration) * 95)));
        opts.onProgress(pct);
      }
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) {
        opts.onProgress(98);
        resolve();
      } else {
        reject(new Error(`FFmpeg export failed (exit ${code}): ${stderrTail}`));
      }
    });
  });

  const verified = await probeMedia(opts.outPath);
  if (verified.width !== width || verified.height !== height) {
    throw new Error(
      `Export verification mismatch: expected ${width}x${height}, got ${verified.width}x${verified.height}`
    );
  }
  opts.onProgress(100);
  return verified;
}
