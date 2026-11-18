import {
  AlertTriangle,
  Film,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Upload,
  Wand2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { t } from '../i18n/translations';
import { api } from '../lib/api';
import type {
  AIModelCapability,
  AspectRatio,
  CostEstimate,
  EnhancedPromptBreakdown,
  GenerationJob,
  Language,
  MediaAsset,
} from '../types/studio';

import { VoiceDictationButton } from './VoiceRecorderStudio';

const DEFAULT_IDEA_PROMPT =
  'Create a cinematic electric sports coupe commercial along a twilight coastal cliff highway';

const GENERATOR_MODES = [
  { id: 'text_to_video', label: 'Text-to-Video', style: 'Photorealistic Cinema' },
  { id: 'image_to_video', label: 'Image-to-Video', style: 'Fluid Camera Motion' },
  { id: 'video_to_video', label: 'Video-to-Video', style: 'Style & Scene Transform' },
  { id: 'cinematic', label: 'AI Cinematic', style: 'Anamorphic 35mm Film' },
  { id: 'animation', label: 'AI Animation', style: 'Stylized 3D Stop-Motion' },
  { id: 'story', label: 'AI Story', style: 'Narrative Multi-Beat Scene' },
  { id: 'advertisement', label: 'AI Advertisement', style: 'High-Impact Commercial Spot' },
  { id: 'product', label: 'AI Product Video', style: 'Macro Luxury Showcase' },
  { id: 'character', label: 'AI Character Video', style: 'Expressive Character Action' },
  { id: 'scene', label: 'AI Scene Generator', style: 'Atmospheric Environment' },
] as const;

interface VideoGeneratorViewProps {
  models: AIModelCapability[];
  media: MediaAsset[];
  jobs: GenerationJob[];
  activeProjectId: string | null;
  language: Language;
  onRefreshJobs: () => Promise<void>;
  onMediaCreated: (asset: MediaAsset) => void;
  onAddToProject: (asset: MediaAsset) => void;
}

export function VideoGeneratorView({
  models,
  media,
  jobs,
  activeProjectId,
  language,
  onRefreshJobs,
  onMediaCreated,
  onAddToProject,
}: VideoGeneratorViewProps) {
  const videoModels = useMemo(
    () =>
      models.filter((m) =>
        ['text_to_video', 'image_to_video', 'video_to_video'].includes(m.capabilityType)
      ),
    [models]
  );

  const [mode, setMode] = useState<string>('image_to_video');
  const [selectedModelId, setSelectedModelId] = useState<string>(
    videoModels[0]?.modelId || 'ffmpeg-kenburns-4k'
  );
  const [ideaPrompt, setIdeaPrompt] = useState(DEFAULT_IDEA_PROMPT);
  const [compiledPrompt, setCompiledPrompt] = useState('');
  const [breakdown, setBreakdown] = useState<EnhancedPromptBreakdown | null>(null);
  const [assisting, setAssisting] = useState(false);

  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [resolution, setResolution] = useState<string>('1080p');
  const [durationSec, setDurationSec] = useState<number>(6);
  const [fps, setFps] = useState<number>(30);
  const [motion, setMotion] = useState<'zoom_in' | 'zoom_out' | 'pan_right' | 'pan_left'>('zoom_in');
  const [sourceMediaId, setSourceMediaId] = useState<string>('');
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedModel = useMemo(
    () => videoModels.find((m) => m.modelId === selectedModelId) || videoModels[0],
    [videoModels, selectedModelId]
  );

  useEffect(() => {
    if (!selectedModelId) return;
    api
      .estimateCost({ modelId: selectedModelId, durationSec, resolution, aspectRatio })
      .then((res) => setEstimate(res.estimate))
      .catch(() => {});
  }, [selectedModelId, durationSec, resolution, aspectRatio]);

  const handlePromptAssist = async () => {
    setAssisting(true);
    setErrorMsg(null);
    try {
      const style = GENERATOR_MODES.find((g) => g.id === mode)?.style || 'Cinematic';
      const res = await api.promptAssist(ideaPrompt, style, language);
      setBreakdown(res.breakdown);
      setCompiledPrompt(res.breakdown.compiledPrompt);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Prompt Assistant failed');
    } finally {
      setAssisting(false);
    }
  };

  const handleUploadSource = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await api.uploadMedia(file, file.name, activeProjectId || undefined);
      onMediaCreated(res.media);
      setSourceMediaId(res.media.id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      e.target.value = '';
    }
  };

  const handleGenerate = async () => {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await api.generateVideo({
        projectId: activeProjectId || undefined,
        modelId: selectedModelId,
        jobType: mode,
        prompt: ideaPrompt,
        enhancedPrompt: compiledPrompt || ideaPrompt,
        params: {
          aspectRatio,
          resolution,
          durationSec,
          fps,
          motion,
          sourceMediaId: sourceMediaId || undefined,
          style: GENERATOR_MODES.find((g) => g.id === mode)?.style,
        },
      });
      await onRefreshJobs();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to start generation');
    } finally {
      setSubmitting(false);
    }
  };

  const sourceCandidates = useMemo(
    () =>
      media.filter((m) =>
        mode === 'video_to_video' ? m.kind === 'video' : m.kind === 'image' || m.kind === 'video'
      ),
    [media, mode]
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">
            {t(language, 'navGenerator')}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Generate videos using local FFmpeg 4K motion composition or configured AI video providers.
          </p>
        </div>
      </div>

      {/* Mode Selector */}
      <div className="flex flex-wrap gap-1.5 p-1.5 rounded-xl bg-[#11131B] border border-white/8">
        {GENERATOR_MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              mode === m.id
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-lg bg-rose-950/50 border border-rose-500/30 text-xs text-rose-200 flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="underline">
            Close
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Prompt & Director Controls */}
        <div className="lg:col-span-7 space-y-5">
          <div className="p-5 rounded-xl bg-[#11131B] border border-white/8 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-sm font-semibold text-white">
                Scene Concept / Prompt
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <VoiceDictationButton
                  language={language}
                  onTranscript={(spoken) =>
                    setIdeaPrompt((prev) =>
                      !prev.trim() || prev === DEFAULT_IDEA_PROMPT
                        ? spoken
                        : `${prev.trim()} ${spoken}`
                    )
                  }
                  onError={(msg) => setErrorMsg(msg)}
                />
                <button
                  onClick={handlePromptAssist}
                  disabled={assisting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-xs font-medium whitespace-nowrap shrink-0"
                >
                  {assisting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>{t(language, 'enhancePrompt')}</span>
                </button>
              </div>
            </div>

            <textarea
              rows={3}
              value={ideaPrompt}
              onChange={(e) => setIdeaPrompt(e.target.value)}
              placeholder="Describe the subject, camera movement, lighting, and mood..."
              className="w-full rounded-lg bg-[#090A0F] border border-white/10 p-3 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
            />

            {breakdown && (
              <div className="p-4 rounded-lg bg-[#0B0D14] border border-indigo-500/25 space-y-3">
                <div className="text-xs font-semibold text-indigo-300">
                  AI Prompt Assistant Breakdown (Editable)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                  <div>
                    <span className="text-slate-400">Subject:</span>{' '}
                    <span className="text-slate-200">{breakdown.subject}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Camera:</span>{' '}
                    <span className="text-slate-200">
                      {breakdown.cameraAngle} · {breakdown.cameraMovement}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Lighting:</span>{' '}
                    <span className="text-slate-200">{breakdown.lighting}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Audio:</span>{' '}
                    <span className="text-slate-200">{breakdown.audioInstructions}</span>
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Compiled Production Prompt (Sent to Model)
                  </label>
                  <textarea
                    rows={3}
                    value={compiledPrompt}
                    onChange={(e) => setCompiledPrompt(e.target.value)}
                    className="w-full rounded bg-[#141722] border border-white/10 p-2.5 text-xs text-slate-100"
                  />
                </div>
              </div>
            )}

            {/* Reference Image / Video */}
            <div className="pt-2 border-t border-white/8 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-300">
                  Reference Image or Source Video
                </span>
                <label className="flex items-center gap-1.5 text-xs text-indigo-300 hover:text-indigo-200 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload Reference</span>
                  <input
                    type="file"
                    accept="image/*,video/*"
                    className="hidden"
                    onChange={handleUploadSource}
                  />
                </label>
              </div>
              <select
                value={sourceMediaId}
                onChange={(e) => setSourceMediaId(e.target.value)}
                className="w-full rounded-lg bg-[#090A0F] border border-white/10 px-3 py-2 text-xs text-slate-200"
              >
                <option value="">Auto-select studio frame / Text-only</option>
                {sourceCandidates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title} ({m.kind} · {m.width}×{m.height})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Model & Output Settings */}
          <div className="p-5 rounded-xl bg-[#11131B] border border-white/8 space-y-4">
            <h2 className="text-sm font-semibold text-white">Model & Technical Parameters</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="sm:col-span-2">
                <label className="block text-slate-400 mb-1">AI Provider & Model</label>
                <select
                  value={selectedModelId}
                  onChange={(e) => setSelectedModelId(e.target.value)}
                  className="w-full rounded-lg bg-[#090A0F] border border-white/10 px-3 py-2.5 text-slate-100"
                >
                  {videoModels.map((m) => (
                    <option key={m.modelId} value={m.modelId}>
                      {m.displayName} — {m.freeTierAvailable ? 'Free Local Engine' : `$${m.pricingPerSecUsd}/sec`}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Resolution</label>
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  className="w-full rounded-lg bg-[#090A0F] border border-white/10 px-3 py-2 text-slate-100"
                >
                  {(selectedModel?.supportedResolutions.length
                    ? selectedModel.supportedResolutions
                    : ['720p', '1080p', '2160p']
                  ).map((r) => (
                    <option key={r} value={r}>
                      {r === '2160p' || r === '4k' ? `${r} (4K UHD)` : r}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Aspect Ratio</label>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
                  className="w-full rounded-lg bg-[#090A0F] border border-white/10 px-3 py-2 text-slate-100"
                >
                  {(selectedModel?.supportedAspectRatios || ['16:9', '9:16']).map((ar) => (
                    <option key={ar} value={ar}>
                      {ar}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">
                  Duration ({selectedModel?.minDurationSec ?? 2}s–{selectedModel?.maxDurationSec ?? 30}s)
                </label>
                <input
                  type="number"
                  min={selectedModel?.minDurationSec ?? 2}
                  max={selectedModel?.maxDurationSec ?? 30}
                  value={durationSec}
                  onChange={(e) => setDurationSec(Number(e.target.value))}
                  className="w-full rounded-lg bg-[#090A0F] border border-white/10 px-3 py-2 text-slate-100 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Camera Movement</label>
                <select
                  value={motion}
                  onChange={(e) =>
                    setMotion(e.target.value as 'zoom_in' | 'zoom_out' | 'pan_right' | 'pan_left')
                  }
                  className="w-full rounded-lg bg-[#090A0F] border border-white/10 px-3 py-2 text-slate-100"
                >
                  <option value="zoom_in">Slow Dolly Zoom In</option>
                  <option value="zoom_out">Wide Pull-Back Reveal</option>
                  <option value="pan_right">Tracking Pan Right</option>
                  <option value="pan_left">Tracking Pan Left</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Frame Rate</label>
                <select
                  value={fps}
                  onChange={(e) => setFps(Number(e.target.value))}
                  className="w-full rounded-lg bg-[#090A0F] border border-white/10 px-3 py-2 text-slate-100"
                >
                  <option value={24}>24 FPS</option>
                  <option value={30}>30 FPS</option>
                  <option value={60}>60 FPS</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Cost Estimator & Background Queue */}
        <div className="lg:col-span-5 space-y-5">
          {estimate && (
            <div className="p-5 rounded-xl bg-[#11131B] border border-white/8 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">{t(language, 'costEstimate')}</h2>
                <span className="text-xs font-mono text-indigo-300 tabular-nums">
                  {estimate.freeModeEligible
                    ? t(language, 'freeEditingMode')
                    : `$${estimate.estimatedCostUsd.toFixed(3)} USD`}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs border-t border-b border-white/8 py-3">
                <div>
                  <div className="text-slate-400">Selected Model</div>
                  <div className="text-slate-100 font-medium mt-0.5">{estimate.displayName}</div>
                </div>
                <div>
                  <div className="text-slate-400">Expected Output</div>
                  <div className="text-slate-100 font-medium mt-0.5">
                    {estimate.expectedQuality} · {estimate.durationSec}s
                  </div>
                </div>
              </div>

              {estimate.warnings.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-500/30 space-y-1 text-xs text-amber-200">
                  {estimate.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={handleGenerate}
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Wand2 className="w-4 h-4" />
                )}
                <span>{t(language, 'generateVideo')}</span>
              </button>

              {estimate.alternatives.length > 0 && (
                <div className="pt-2 space-y-1.5">
                  <div className="text-[11px] text-slate-400">Alternative Models</div>
                  {estimate.alternatives.map((alt) => (
                    <button
                      key={alt.modelId}
                      onClick={() => setSelectedModelId(alt.modelId)}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-[#090A0F] hover:bg-white/5 border border-white/6 text-xs text-left"
                    >
                      <span className="text-slate-200 truncate">{alt.displayName}</span>
                      <span className="font-mono text-slate-400 tabular-nums shrink-0 ml-2">
                        {alt.estimatedCostUsd === 0 ? 'Free' : `$${alt.estimatedCostUsd.toFixed(2)}`} ·{' '}
                        {alt.maxResolution}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Recent Generation Jobs */}
          <div className="p-5 rounded-xl bg-[#11131B] border border-white/8 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Generation Jobs</h2>
              <button
                onClick={onRefreshJobs}
                className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Refresh</span>
              </button>
            </div>

            {jobs.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                No generation tasks queued yet.
              </p>
            ) : (
              <div className="space-y-2.5 max-h-96 overflow-y-auto">
                {jobs.slice(0, 8).map((job) => (
                  <div
                    key={job.id}
                    className="p-3 rounded-lg bg-[#090A0F] border border-white/8 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-200 truncate">{job.prompt}</span>
                      <span
                        className={`font-mono text-[11px] capitalize shrink-0 ${
                          job.status === 'completed'
                            ? 'text-emerald-400'
                            : job.status === 'failed'
                              ? 'text-rose-400'
                              : 'text-indigo-300'
                        }`}
                      >
                        {job.status} · {job.progress}%
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-500 font-mono">
                      {job.modelId} · Cost ${job.actualCostUsd.toFixed(3)}
                    </div>

                    {job.status === 'failed' && (
                      <div className="space-y-1.5">
                        <p className="text-[11px] text-rose-300">{job.errorMessage}</p>
                        <button
                          onClick={async () => {
                            await api.retryJob(job.id);
                            await onRefreshJobs();
                          }}
                          className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/15 text-white text-[11px]"
                        >
                          Retry Task
                        </button>
                      </div>
                    )}

                    {job.status === 'completed' && job.outputMedia && (
                      <div className="space-y-2 pt-1">
                        {job.outputMedia.kind === 'video' && (
                          <video
                            src={job.outputMedia.url}
                            controls
                            className="w-full rounded border border-white/10 max-h-40 bg-black"
                          />
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-slate-400 font-mono tabular-nums">
                            {job.outputMedia.width}×{job.outputMedia.height} ·{' '}
                            {job.outputMedia.durationSec.toFixed(1)}s
                          </span>
                          <button
                            onClick={() => onAddToProject(job.outputMedia!)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Send to Timeline</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
