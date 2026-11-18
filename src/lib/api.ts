import type {
  AIModelCapability,
  AIProvider,
  AspectRatio,
  BillingSummary,
  CostEstimate,
  EnhancedPromptBreakdown,
  ExportCodec,
  ExportFormat,
  ExportJob,
  ExportResolution,
  GenerationJob,
  Language,
  MediaAsset,
  Project,
  ProjectVersion,
  SubtitleCue,
  UserProfile,
  UserSettings,
} from '../types/studio';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  getMe: () => request<{ user: UserProfile; settings: UserSettings }>('/api/auth/me'),
  login: (email: string, password: string) =>
    request<{ ok: boolean }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, name: string, password: string, language: Language) =>
    request<{ ok: boolean }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, name, password, language }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  updateSettings: (payload: Partial<UserSettings>) =>
    request<{ ok: boolean }>('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  listProjects: (q?: string, folder?: string) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (folder) params.set('folder', folder);
    return request<{ projects: Project[] }>(`/api/projects?${params.toString()}`);
  },
  createProject: (payload: Partial<Project>) =>
    request<{ project: Project }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateProject: (id: string, payload: Partial<Project> & { versionLabel?: string }) =>
    request<{ project: Project }>(`/api/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  duplicateProject: (id: string) =>
    request<{ project: Project }>(`/api/projects/${id}/duplicate`, { method: 'POST' }),
  deleteProject: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),
  listVersions: (id: string) =>
    request<{ versions: ProjectVersion[] }>(`/api/projects/${id}/versions`),
  restoreVersion: (projectId: string, versionId: string) =>
    request<{ project: Project }>(`/api/projects/${projectId}/versions/${versionId}/restore`, {
      method: 'POST',
    }),

  listMedia: () => request<{ media: MediaAsset[] }>('/api/media'),
  uploadMedia: (file: File, title?: string, projectId?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    if (title) fd.append('title', title);
    if (projectId) fd.append('projectId', projectId);
    return request<{ media: MediaAsset }>('/api/media/upload', { method: 'POST', body: fd });
  },
  deleteMedia: (id: string) => request<{ ok: boolean }>(`/api/media/${id}`, { method: 'DELETE' }),

  getRegistry: () =>
    request<{ providers: AIProvider[]; models: AIModelCapability[] }>('/api/ai/registry'),
  promptAssist: (idea: string, style: string, language: Language) =>
    request<{ breakdown: EnhancedPromptBreakdown }>('/api/ai/prompt-assist', {
      method: 'POST',
      body: JSON.stringify({ idea, style, language }),
    }),
  estimateCost: (payload: {
    modelId: string;
    durationSec: number;
    resolution: string;
    aspectRatio: AspectRatio;
  }) =>
    request<{ estimate: CostEstimate }>('/api/ai/estimate-cost', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  generateVideo: (payload: {
    projectId?: string;
    modelId: string;
    jobType: string;
    prompt: string;
    enhancedPrompt?: string;
    params: Record<string, unknown>;
  }) =>
    request<{ jobId: string; status: string; estimate: CostEstimate }>('/api/ai/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listJobs: () => request<{ jobs: GenerationJob[] }>('/api/jobs'),
  retryJob: (id: string) => request<{ ok: boolean }>(`/api/jobs/${id}/retry`, { method: 'POST' }),

  processVideoTool: (payload: {
    mediaId: string;
    tool: 'upscale_4k' | 'enhance' | 'denoise_video' | 'denoise_audio' | 'chroma_key';
    chromaColor?: string;
    similarity?: number;
  }) =>
    request<{ media: MediaAsset }>('/api/tools/process', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  analyzeVideo: (mediaId: string, language: Language) =>
    request<{
      sceneTimestamps: number[];
      transcript: string;
      summary: string;
      highlights: Array<{ startSec: number; endSec: number; reason: string }>;
      autoEditNotes: string[];
    }>('/api/tools/analyze', {
      method: 'POST',
      body: JSON.stringify({ mediaId, language }),
    }),

  generateTts: (payload: {
    text: string;
    voiceName: string;
    style?: string;
    language?: Language;
    dualSpeaker?: boolean;
    secondSpeakerText?: string;
    secondVoiceName?: string;
    title?: string;
  }) =>
    request<{ media: MediaAsset }>('/api/audio/tts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  micToSpeech: (
    audioBlob: Blob,
    opts: {
      voiceName: string;
      style?: string;
      language: Language;
      mode: 'exact' | 'polish' | 'reply';
    }
  ) => {
    const fd = new FormData();
    const ext = audioBlob.type.includes('mp4') ? 'mp4' : audioBlob.type.includes('ogg') ? 'ogg' : 'webm';
    fd.append('audio', audioBlob, `mic_recording.${ext}`);
    fd.append('voiceName', opts.voiceName);
    if (opts.style) fd.append('style', opts.style);
    fd.append('language', opts.language);
    fd.append('mode', opts.mode);
    return request<{ transcript: string; spokenText: string; media: MediaAsset }>(
      '/api/audio/mic-to-speech',
      { method: 'POST', body: fd }
    );
  },
  micTranscribe: (
    audioBlob: Blob,
    opts?: {
      language?: Language;
      mode?: 'exact' | 'polish';
    }
  ) => {
    const fd = new FormData();
    const ext = audioBlob.type.includes('mp4') ? 'mp4' : audioBlob.type.includes('ogg') ? 'ogg' : 'webm';
    fd.append('audio', audioBlob, `voice_input.${ext}`);
    if (opts?.language) fd.append('language', opts.language);
    if (opts?.mode) fd.append('mode', opts.mode);
    return request<{ transcript: string; text: string }>('/api/audio/mic-transcribe', {
      method: 'POST',
      body: fd,
    });
  },
  transcribeMedia: (mediaId: string, targetLanguage: string) =>
    request<{ transcript: string; cues: SubtitleCue[] }>('/api/audio/stt', {
      method: 'POST',
      body: JSON.stringify({ mediaId, targetLanguage }),
    }),
  translateText: (text: string, targetLanguage: Language) =>
    request<{ translated: string }>('/api/audio/translate', {
      method: 'POST',
      body: JSON.stringify({ text, targetLanguage }),
    }),
  generateMusic: (prompt: string, modelId?: 'lyria-3-clip-preview' | 'lyria-3-pro-preview') =>
    request<{ media: MediaAsset; lyrics: string }>('/api/audio/music', {
      method: 'POST',
      body: JSON.stringify({ prompt, modelId }),
    }),

  generateImage: (payload: {
    prompt: string;
    modelId: 'gemini-3.1-flash-lite-image' | 'gemini-nano-banana-2.1';
    aspectRatio: string;
    imageSize?: '1K' | '2K' | '4K';
    sourceMediaId?: string;
  }) =>
    request<{ media: MediaAsset }>('/api/image/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  startExport: (payload: {
    projectId: string;
    resolution: ExportResolution;
    aspectRatio: AspectRatio;
    fps: number;
    format: ExportFormat;
    codec: ExportCodec;
  }) =>
    request<{ exportId: string; qualityClassification: string }>('/api/exports', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listExports: () => request<{ exports: ExportJob[] }>('/api/exports'),
  retryExport: (id: string) =>
    request<{ ok: boolean }>(`/api/exports/${id}/retry`, { method: 'POST' }),

  getAdminProviders: () =>
    request<{ providers: AIProvider[]; models: AIModelCapability[] }>('/api/admin/providers'),
  updateProvider: (
    id: string,
    payload: { enabled?: boolean; apiKey?: string; rateLimitRpm?: number; baseUrl?: string }
  ) =>
    request<{ providers: AIProvider[] }>(`/api/admin/providers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  testProvider: (id: string) =>
    request<{ ok: boolean; message: string }>(`/api/admin/providers/${id}/test`, {
      method: 'POST',
    }),
  addProvider: (payload: {
    name: string;
    slug: string;
    category: 'video' | 'image' | 'audio' | 'text';
    baseUrl: string;
    apiKey?: string;
    rateLimitRpm?: number;
  }) =>
    request<{ providers: AIProvider[] }>('/api/admin/providers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  addModel: (payload: Record<string, unknown>) =>
    request<{ models: AIModelCapability[] }>('/api/admin/models', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getBillingSummary: () => request<BillingSummary>('/api/billing/summary'),
};
