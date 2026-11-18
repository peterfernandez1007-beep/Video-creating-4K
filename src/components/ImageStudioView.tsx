import { Film, Image as ImageIcon, Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import type { MediaAsset } from '../types/studio';
import { VoiceDictationButton } from './VoiceRecorderStudio';

const DEFAULT_IMAGE_PROMPT =
  'Ultra-sharp commercial automotive billboard photography, dark slate studio lighting, dramatic rim highlights';

interface ImageStudioViewProps {
  media: MediaAsset[];
  onMediaCreated: (asset: MediaAsset) => void;
  onAddToProject: (asset: MediaAsset) => void;
  onSendToVideoGen: () => void;
}

export function ImageStudioView({
  media,
  onMediaCreated,
  onAddToProject,
  onSendToVideoGen,
}: ImageStudioViewProps) {
  const [prompt, setPrompt] = useState(DEFAULT_IMAGE_PROMPT);
  const [modelId, setModelId] = useState<'gemini-3.1-flash-lite-image' | 'gemini-nano-banana-2.1'>(
    'gemini-nano-banana-2.1'
  );
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [imageSize, setImageSize] = useState<'1K' | '2K' | '4K'>('4K');
  const [sourceMediaId, setSourceMediaId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [latestImage, setLatestImage] = useState<MediaAsset | null>(null);

  const imageAssets = media.filter((m) => m.kind === 'image');

  const handleGenerate = async () => {
    setGenerating(true);
    setErrorMsg(null);
    try {
      const res = await api.generateImage({
        prompt,
        modelId,
        aspectRatio,
        imageSize,
        sourceMediaId: sourceMediaId || undefined,
      });
      setLatestImage(res.media);
      onMediaCreated(res.media);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Image generation failed');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">AI Image Studio</h1>
        <p className="text-sm text-slate-400 mt-1">
          Generate 4K thumbnails, storyboards, and source frames for Image-to-Video animation.
        </p>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-lg bg-rose-950/50 border border-rose-500/30 text-xs text-rose-200">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 p-5 rounded-xl bg-[#11131B] border border-white/8 space-y-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-medium text-slate-300">
                Image Prompt or Edit Instruction
              </label>
              <VoiceDictationButton
                onTranscript={(spoken) =>
                  setPrompt((prev) =>
                    !prev.trim() || prev === DEFAULT_IMAGE_PROMPT
                      ? spoken
                      : `${prev.trim()} ${spoken}`
                  )
                }
                onError={(msg) => setErrorMsg(msg)}
              />
            </div>
            <textarea
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full rounded-lg bg-[#090A0F] border border-white/10 p-3 text-sm text-slate-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="col-span-2">
              <label className="block text-slate-400 mb-1">Model (Paid Tier Key Required)</label>
              <select
                value={modelId}
                onChange={(e) =>
                  setModelId(e.target.value as 'gemini-3.1-flash-lite-image' | 'gemini-nano-banana-2.1')
                }
                className="w-full rounded-lg bg-[#090A0F] border border-white/10 px-3 py-2 text-slate-100"
              >
                <option value="gemini-nano-banana-2.1">Nano Banana 2.1 (1K / 2K / 4K)</option>
                <option value="gemini-3.1-flash-lite-image">Gemini 3.1 Flash Lite Image</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Aspect Ratio</label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                className="w-full rounded-lg bg-[#090A0F] border border-white/10 px-3 py-2 text-slate-100"
              >
                <option value="16:9">16:9 Thumbnail</option>
                <option value="9:16">9:16 Vertical</option>
                <option value="1:1">1:1 Square</option>
                <option value="4:3">4:3 Classic</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Output Resolution</label>
              <select
                value={imageSize}
                onChange={(e) => setImageSize(e.target.value as '1K' | '2K' | '4K')}
                disabled={modelId !== 'gemini-nano-banana-2.1'}
                className="w-full rounded-lg bg-[#090A0F] border border-white/10 px-3 py-2 text-slate-100 disabled:opacity-40"
              >
                <option value="1K">1K</option>
                <option value="2K">2K</option>
                <option value="4K">4K UHD</option>
              </select>
            </div>
          </div>

          <div className="text-xs">
            <label className="block text-slate-400 mb-1">Optional Reference Image (for Editing)</label>
            <select
              value={sourceMediaId}
              onChange={(e) => setSourceMediaId(e.target.value)}
              className="w-full rounded-lg bg-[#090A0F] border border-white/10 px-3 py-2 text-slate-100"
            >
              <option value="">None (Generate from text)</option>
              {imageAssets.map((img) => (
                <option key={img.id} value={img.id}>
                  {img.title}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
            <span>Generate Image</span>
          </button>
        </div>

        <div className="lg:col-span-7 space-y-4">
          {latestImage && (
            <div className="p-4 rounded-xl bg-[#11131B] border border-white/8 space-y-3">
              <img
                src={latestImage.url}
                alt={latestImage.title}
                referrerPolicy="no-referrer"
                className="w-full rounded-lg max-h-96 object-contain bg-black"
              />
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-slate-400 tabular-nums">
                  {latestImage.width}×{latestImage.height}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => onAddToProject(latestImage)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded bg-indigo-600 text-white font-medium"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add to Timeline</span>
                  </button>
                  <button
                    onClick={onSendToVideoGen}
                    className="flex items-center gap-1 px-3 py-1.5 rounded bg-white/10 text-white font-medium"
                  >
                    <Film className="w-3.5 h-3.5" />
                    <span>Animate to Video</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="p-5 rounded-xl bg-[#11131B] border border-white/8 space-y-3">
            <h2 className="text-sm font-semibold text-white">Studio Image Frames ({imageAssets.length})</h2>
            {imageAssets.length === 0 ? (
              <p className="text-xs text-slate-500">
                Upload images in the Editor Media Library or generate frames here.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {imageAssets.map((img) => (
                  <div key={img.id} className="rounded-lg bg-[#090A0F] border border-white/8 overflow-hidden">
                    <img
                      src={img.url}
                      alt={img.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-28 object-cover"
                    />
                    <div className="p-2 flex items-center justify-between gap-1 text-[11px]">
                      <span className="truncate text-slate-300">{img.title}</span>
                      <button
                        onClick={() => onAddToProject(img)}
                        className="p-1 rounded bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600 hover:text-white"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
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
