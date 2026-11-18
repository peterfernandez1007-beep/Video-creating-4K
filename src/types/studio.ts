export type Language = 'en' | 'hi';

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5' | '21:9';
export type ExportResolution = '720p' | '1080p' | '1440p' | '2160p';
export type ExportFPS = 24 | 30 | 60;
export type ExportFormat = 'mp4' | 'webm';
export type ExportCodec = 'h264' | 'h265' | 'vp9';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'creator';
  language: Language;
  createdAt: string;
}

export interface UserSettings {
  userId: string;
  defaultResolution: ExportResolution;
  defaultFps: ExportFPS;
  defaultAspectRatio: AspectRatio;
  autosaveIntervalSec: number;
  uiLanguage: Language;
}

export interface MediaAsset {
  id: string;
  userId: string;
  projectId: string | null;
  kind: 'video' | 'image' | 'audio';
  title: string;
  filename: string;
  mimeType: string;
  url: string;
  thumbnailUrl: string | null;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  isNative4k: boolean;
  sourceType: 'upload' | 'starter' | 'ai_generated' | 'ffmpeg_rendered';
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface KeyframePoint {
  timeOffsetSec: number;
  opacity?: number;
  scale?: number;
  x?: number;
  y?: number;
}

export interface ClipProperties {
  speed: number;
  reverse: boolean;
  opacity: number;
  brightness: number; // -0.5 to 0.5
  contrast: number; // 0.5 to 2.0
  saturation: number; // 0 to 2.0
  filter: 'none' | 'cinema_warm' | 'noir_bw' | 'teal_orange' | 'vintage';
  transitionIn: 'none' | 'fade' | 'crossfade' | 'wipe';
  transitionDurationSec: number;
  chromaKeyEnabled: boolean;
  chromaKeyColor: string;
  chromaKeySimilarity: number;
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  rotationDeg: number;
  scale: number;
  volume: number; // 0 to 2
  textContent?: string;
  textColor?: string;
  textBgColor?: string;
  fontSize?: number;
  textAnimation?: 'none' | 'fade_up' | 'typewriter' | 'slide_left';
  textPosition?: 'bottom' | 'center' | 'top';
  keyframes?: KeyframePoint[];
}

export interface TimelineClip {
  id: string;
  trackId: string;
  mediaId: string | null;
  kind: 'video' | 'image' | 'audio' | 'text';
  label: string;
  startSec: number;
  durationSec: number;
  inSec: number;
  outSec: number;
  properties: ClipProperties;
}

export interface TimelineTrack {
  id: string;
  kind: 'video' | 'audio' | 'text';
  name: string;
  orderIndex: number;
  muted: boolean;
  locked: boolean;
  volume: number;
}

export interface TimelineState {
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  subtitles: SubtitleCue[];
}

export interface SubtitleCue {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
}

export interface Project {
  id: string;
  userId: string;
  folder: string;
  title: string;
  description: string;
  aspectRatio: AspectRatio;
  targetResolution: ExportResolution;
  targetFps: ExportFPS;
  timeline: TimelineState;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectVersion {
  id: string;
  projectId: string;
  version: number;
  label: string;
  createdAt: string;
}

export interface AIProvider {
  id: string;
  slug: string;
  name: string;
  category: 'video' | 'image' | 'audio' | 'text';
  enabled: boolean;
  authType: 'env_gemini' | 'bearer_key' | 'local_ffmpeg';
  baseUrl: string;
  hasApiKey: boolean;
  rateLimitRpm: number;
  status: 'ready' | 'unconfigured' | 'error' | 'disabled';
  lastTestedAt: string | null;
  lastError: string | null;
}

export interface AIModelCapability {
  id: string;
  providerId: string;
  providerName: string;
  providerSlug: string;
  modelId: string;
  displayName: string;
  capabilityType:
    | 'text_to_video'
    | 'image_to_video'
    | 'video_to_video'
    | 'text_to_image'
    | 'tts'
    | 'stt'
    | 'music'
    | 'prompt_llm';
  supportedResolutions: string[];
  native4k: boolean;
  supportedAspectRatios: AspectRatio[];
  minDurationSec: number;
  maxDurationSec: number;
  supportsAudio: boolean;
  inputTypes: string[];
  pricingPerSecUsd: number;
  pricingPerCallUsd: number;
  freeTierAvailable: boolean;
  status: 'active' | 'requires_paid_key' | 'requires_provider_key' | 'disabled';
}

export interface CostEstimate {
  modelId: string;
  displayName: string;
  providerName: string;
  estimatedCostUsd: number;
  freeModeEligible: boolean;
  expectedQuality: string;
  native4k: boolean;
  durationSec: number;
  warnings: string[];
  alternatives: Array<{
    modelId: string;
    displayName: string;
    estimatedCostUsd: number;
    maxResolution: string;
  }>;
}

export interface GenerationJob {
  id: string;
  userId: string;
  projectId: string | null;
  providerId: string;
  modelId: string;
  jobType: string;
  prompt: string;
  enhancedPrompt: string | null;
  params: Record<string, unknown>;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  estimatedCostUsd: number;
  actualCostUsd: number;
  outputMediaId: string | null;
  outputMedia?: MediaAsset | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportJob {
  id: string;
  userId: string;
  projectId: string;
  projectTitle: string;
  resolution: ExportResolution;
  aspectRatio: AspectRatio;
  fps: ExportFPS;
  format: ExportFormat;
  codec: ExportCodec;
  qualityClassification: 'native_4k' | 'upscaled_4k' | 'native_hd' | 'upscaled';
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  downloadUrl: string | null;
  outputSizeBytes: number | null;
  verifiedWidth: number | null;
  verifiedHeight: number | null;
  verifiedFps: number | null;
  verifiedCodec: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnhancedPromptBreakdown {
  sceneDescription: string;
  subject: string;
  cameraAngle: string;
  cameraMovement: string;
  lighting: string;
  environment: string;
  visualStyle: string;
  motionDescription: string;
  audioInstructions: string;
  sceneContinuity: string;
  compiledPrompt: string;
}

export interface ApiUsageRecord {
  id: string;
  providerId: string;
  providerName: string;
  modelId: string;
  jobId: string | null;
  units: string;
  costUsd: number;
  status: 'success' | 'failed';
  createdAt: string;
}

export interface BillingSummary {
  totalSpentUsd: number;
  freeOperationsCount: number;
  paidOperationsCount: number;
  usage: ApiUsageRecord[];
}
