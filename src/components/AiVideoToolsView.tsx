import { Activity, Loader2, Plus, Scissors, Sparkles, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import type { Language, MediaAsset } from '../types/studio';

interface AiVideoToolsViewProps {
  media: MediaAsset[];
  language: Language;
  onMediaCreated: (asset: MediaAsset) => void;
  onAddToProject: (asset: MediaAsset) => void;
}

export function AiVideoToolsView({
  media,
  language,
  onMediaCreated,
  onAddToProject,
}: AiVideoToolsViewProps) {
  const videoAssets = media.filter((m) => m.kind === 'video');
  const [selectedMediaId, setSelectedMediaId] = useState(videoAssets[0]?.id || '');
  const [chromaColor, setChromaColor] = useState('#00FF00');
  const [similarity, setSimilarity] = useState(0.25);
  const [processingTool, setProcessingTool] = useState<string | null>(null);
  const [resultMedia, setResultMedia] = useState<MediaAsset | null>(null);

  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<{
    sceneTimestamps: number[];
    transcript: string;
    summary: string;
    highlights: Array<{ startSec: number; endSec: number; reason: string }>;
    autoEditNotes: string[];
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const runTool = async (
    tool: 'upscale_4k' | 'enhance' | 'denoise_video' | 'denoise_audio' | 'chroma_key'
  ) => {
    if (!selectedMediaId) return;
    setProcessingTool(tool);
    setErrorMsg(null);
    try {
      const res = await api.processVideoTool({
        mediaId: selectedMediaId,
        tool,
        chromaColor,
        similarity,
      });
      setResultMedia(res.media);
      onMediaCreated(res.media);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Tool processing failed');
    } finally {
      setProcessingTool(null);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedMediaId) return;
    setAnalyzing(true);
    setErrorMsg(null);
    try {
      const res = await api.analyzeVideo(selectedMediaId, language);
      setAnalysis(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Video analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">AI Video Tools</h1>
        <p className="text-sm text-slate-400 mt-1">
          Real FFmpeg enhancement, Lanczos 4K upscaling, noise removal, scene detection, and Gemini auto-edit analysis.
        </p>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-lg bg-rose-950/50 border border-rose-500/30 text-xs text-rose-200">
          {errorMsg}
        </div>
      )}

      <div className="p-5 rounded-xl bg-[#11131B] border border-white/8 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <label className="block text-xs text-slate-400 mb-1">Target Video Clip</label>
            <select
              value={selectedMediaId}
              onChange={(e) => setSelectedMediaId(e.target.value)}
              className="w-full rounded-lg bg-[#090A0F] border border-white/10 px-3 py-2 text-xs text-slate-100"
            >
              {videoAssets.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.title} ({v.width}×{v.height} · {v.durationSec.toFixed(1)}s)
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleAnalyze}
            disabled={analyzing || !selectedMediaId}
            className="sm:mt-5 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold whitespace-nowrap shrink-0"
          >
            {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
            <span>Detect Scenes & Summarize</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-2">
          {(
            [
              ['enhance', 'Video Enhancer', 'Sharpen, denoise & balance'],
              ['upscale_4k', 'Upscaler (2160p)', 'Lanczos upscale · labeled Upscaled 4K'],
              ['denoise_video', 'Video Denoiser', 'Temporal spatial grain removal'],
              ['denoise_audio', 'Audio Noise Removal', 'FFmpeg FFT spectral cleanup'],
              ['chroma_key', 'Background Keying', 'Remove solid green/blue backdrop'],
            ] as const
          ).map(([id, title, desc]) => (
            <button
              key={id}
              onClick={() => runTool(id)}
              disabled={Boolean(processingTool) || !selectedMediaId}
              className="p-4 rounded-xl bg-[#090A0F] hover:bg-[#161925] border border-white/8 text-left space-y-1.5 transition-colors disabled:opacity-50"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white">{title}</span>
                {processingTool === id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                ) : (
                  <Wand2 className="w-3.5 h-3.5 text-indigo-400" />
                )}
              </div>
              <p className="text-[11px] text-slate-400">{desc}</p>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-white/8 text-xs text-slate-300">
          <label className="flex items-center gap-2">
            <span>Chroma Key Color</span>
            <input
              type="color"
              value={chromaColor}
              onChange={(e) => setChromaColor(e.target.value)}
              className="w-7 h-7 bg-transparent border border-white/10 rounded"
            />
          </label>
          <label className="flex items-center gap-2">
            <span>Tolerance</span>
            <input
              type="range"
              min={0.05}
              max={0.6}
              step={0.05}
              value={similarity}
              onChange={(e) => setSimilarity(Number(e.target.value))}
              className="w-28 accent-indigo-500"
            />
            <span className="font-mono tabular-nums">{similarity}</span>
          </label>
        </div>
      </div>

      {resultMedia && (
        <div className="p-5 rounded-xl bg-[#11131B] border border-emerald-500/30 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-white">{resultMedia.title}</div>
              <div className="text-xs text-slate-400 font-mono tabular-nums">
                {resultMedia.width}×{resultMedia.height} · {resultMedia.fps} FPS ·{' '}
                {resultMedia.isNative4k ? 'Native 4K' : 'Processed / Upscaled Output'}
              </div>
            </div>
            <button
              onClick={() => onAddToProject(resultMedia)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add to Editor Timeline</span>
            </button>
          </div>
          <video
            src={resultMedia.url}
            controls
            className="w-full max-h-80 rounded-lg bg-black border border-white/10"
          />
        </div>
      )}

      {analysis && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="p-5 rounded-xl bg-[#11131B] border border-white/8 space-y-3">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <span>AI Video Summary & Auto-Editor Notes</span>
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed">{analysis.summary}</p>
            <div className="pt-2 border-t border-white/8 space-y-1.5">
              <div className="text-xs font-medium text-slate-400">Auto-Edit Recommendations</div>
              <ul className="space-y-1 text-xs text-slate-200 list-disc pl-4">
                {analysis.autoEditNotes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="p-5 rounded-xl bg-[#11131B] border border-white/8 space-y-3">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Scissors className="w-4 h-4 text-indigo-400" />
              <span>Detected Scene Cuts & Highlights</span>
            </h2>
            <div className="text-xs text-slate-400 font-mono">
              FFmpeg Scene Timestamps (sec): {analysis.sceneTimestamps.join(', ')}
            </div>
            <div className="space-y-2 pt-2">
              {analysis.highlights.map((h, i) => (
                <div
                  key={i}
                  className="p-2.5 rounded-lg bg-[#090A0F] border border-white/8 flex items-center justify-between text-xs"
                >
                  <span className="text-slate-200">{h.reason}</span>
                  <span className="font-mono text-indigo-300 tabular-nums shrink-0 ml-3">
                    {h.startSec.toFixed(1)}s – {h.endSec.toFixed(1)}s
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
