import {
  Copy,
  Download,
  Film,
  FolderOpen,
  Layers,
  Mic,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useState } from 'react';
import { t } from '../i18n/translations';
import { api } from '../lib/api';
import type {
  AspectRatio,
  ExportJob,
  ExportResolution,
  GenerationJob,
  Language,
  MediaAsset,
  Project,
  UserSettings,
} from '../types/studio';
import type { StudioRoute } from './SidebarNav';

const STARTER_TEMPLATES = [
  {
    id: 'tpl-automotive',
    title: 'Horizon GT Commercial (16:9)',
    folder: 'Commercials',
    aspectRatio: '16:9' as AspectRatio,
    resolution: '1080p' as ExportResolution,
    image: '/src/assets/images/studio_hero_cinema_1794989743261.jpg',
    mediaId: 'asset-starter-cinema',
    overlayText: 'HORIZON GT — SILENT VELOCITY',
    description: 'Anamorphic automotive launch spot with cinema warm grading and title reveal.',
  },
  {
    id: 'tpl-product',
    title: 'Titanium Chronograph Launch (16:9)',
    folder: 'Commercials',
    aspectRatio: '16:9' as AspectRatio,
    resolution: '1080p' as ExportResolution,
    image: '/src/assets/images/template_product_watch_1794989744225.jpg',
    mediaId: 'asset-starter-watch',
    overlayText: 'PRECISION TITANIUM SERIES',
    description: 'High-contrast luxury hardware spot with smooth pan and lower-third callout.',
  },
  {
    id: 'tpl-vertical',
    title: 'Architectural Atrium Reel (9:16)',
    folder: 'Social',
    aspectRatio: '9:16' as AspectRatio,
    resolution: '1080p' as ExportResolution,
    image: '/src/assets/images/template_vertical_reel_1794989744860.jpg',
    mediaId: 'asset-starter-vertical',
    overlayText: 'LIGHT & CONCRETE',
    description: 'Vertical 9:16 social showcase configured for Reels and Shorts export.',
  },
  {
    id: 'tpl-animation',
    title: 'Observatory Stop-Motion Story (16:9)',
    folder: 'Workspace',
    aspectRatio: '16:9' as AspectRatio,
    resolution: '1080p' as ExportResolution,
    image: '/src/assets/images/template_animation_world_1794989746155.jpg',
    mediaId: 'asset-starter-animation',
    overlayText: 'CHAPTER I: THE NIGHT SKY',
    description: 'Miniature diorama sequence with warm color balance and narrative title.',
  },
];

export function HomeDashboardView({
  projects,
  media,
  exportsList,
  language,
  onNavigate,
  onOpenProject,
  onCreateProject,
}: {
  projects: Project[];
  media: MediaAsset[];
  exportsList: ExportJob[];
  language: Language;
  onNavigate: (r: StudioRoute) => void;
  onOpenProject: (p: Project) => void;
  onCreateProject: () => Promise<void>;
}) {
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Focal Hero Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch rounded-2xl bg-[#11131B] border border-white/8 overflow-hidden">
        <div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-between space-y-6">
          <div className="space-y-3">
            <div className="text-xs font-medium text-indigo-300">
              Free Editing Mode · Multi-Track FFmpeg + Gemini Studio
            </div>
            <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold text-white leading-tight">
              {t(language, 'heroTitle')}
            </h1>
            <p className="text-sm text-slate-300 max-w-xl leading-relaxed">
              {t(language, 'heroSubtitle')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={onCreateProject}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>{t(language, 'newProject')}</span>
            </button>
            <button
              onClick={() => onNavigate('editor')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#1A1E2B] hover:bg-[#23293A] border border-white/10 text-slate-100 text-sm font-medium whitespace-nowrap shrink-0"
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>{t(language, 'openEditor')}</span>
            </button>
          </div>
        </div>

        <div className="lg:col-span-5 relative min-h-[220px] bg-black">
          <img
            src="/src/assets/images/studio_hero_cinema_1794989743261.jpg"
            alt="AI Video Studio 4K Cinema Frame"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent flex items-end p-5">
            <div className="text-xs text-slate-200 font-mono tabular-nums">
              3840×2160 4K Mastering · H.264 / H.265 / VP9
            </div>
          </div>
        </div>
      </div>

      {/* Studio Quick Modules */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {(
          [
            ['generator', 'AI Video Generator', 'Text, Image & Video-to-Video', Film],
            ['editor', 'Multi-Track Editor', 'Trim, Split, Color Grade & 4K Export', SlidersHorizontal],
            ['audio', 'AI Audio Studio', 'EN/HI Voiceover, Subtitles & Dubs', Mic],
            ['tools', 'AI Video Tools', '4K Upscale, Denoise & Scene Cuts', Wand2],
          ] as const
        ).map(([route, title, desc, Icon]) => (
          <button
            key={route}
            onClick={() => onNavigate(route)}
            className="p-5 rounded-xl bg-[#11131B] hover:bg-[#171A26] border border-white/8 text-left space-y-2 transition-colors"
          >
            <Icon className="w-5 h-5 text-indigo-400" />
            <div className="text-sm font-semibold text-white">{title}</div>
            <p className="text-xs text-slate-400">{desc}</p>
          </button>
        ))}
      </div>

      {/* Recent Projects & Export Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 p-5 rounded-xl bg-[#11131B] border border-white/8 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Recent Projects ({projects.length})</h2>
            <button
              onClick={() => onNavigate('projects')}
              className="text-xs text-indigo-300 hover:text-indigo-200"
            >
              View All
            </button>
          </div>
          <div className="divide-y divide-white/6">
            {projects.slice(0, 5).map((p) => (
              <div
                key={p.id}
                className="py-3 flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-100 truncate">{p.title}</div>
                  <div className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
                    {p.folder} · {p.aspectRatio} · {p.targetResolution} · {p.timeline.clips.length} clips
                  </div>
                </div>
                <button
                  onClick={() => onOpenProject(p)}
                  className="px-3 py-1.5 rounded-lg bg-white/8 hover:bg-indigo-600 text-xs font-medium text-white transition-colors shrink-0"
                >
                  Open
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-4 p-5 rounded-xl bg-[#11131B] border border-white/8 space-y-4">
          <h2 className="text-sm font-semibold text-white">Studio Inventory</h2>
          <div className="space-y-3 text-xs">
            <div className="flex justify-between py-2 border-b border-white/6">
              <span className="text-slate-400">Media Assets</span>
              <span className="font-mono tabular-nums text-white">{media.length}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-white/6">
              <span className="text-slate-400">Completed Exports</span>
              <span className="font-mono tabular-nums text-white">
                {exportsList.filter((e) => e.status === 'completed').length}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-slate-400">FFmpeg 4K Engine</span>
              <span className="text-emerald-400 font-medium">Ready</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TemplatesView({
  onLaunchTemplate,
}: {
  onLaunchTemplate: (tpl: (typeof STARTER_TEMPLATES)[number]) => Promise<void>;
}) {
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">Studio Templates</h1>
        <p className="text-sm text-slate-400 mt-1">
          Start immediately with pre-graded timelines, aspect ratios, and real MP4 starter footage.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {STARTER_TEMPLATES.map((tpl) => (
          <div
            key={tpl.id}
            className="rounded-xl bg-[#11131B] border border-white/8 overflow-hidden flex flex-col"
          >
            <div className="h-52 bg-black overflow-hidden relative">
              <img
                src={tpl.image}
                alt={tpl.title}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
              <div>
                <div className="text-xs text-slate-400 font-mono">
                  {tpl.folder} · {tpl.aspectRatio} · {tpl.resolution}
                </div>
                <h3 className="text-base font-semibold text-white mt-1">{tpl.title}</h3>
                <p className="text-xs text-slate-400 mt-1">{tpl.description}</p>
              </div>
              <button
                onClick={() => onLaunchTemplate(tpl)}
                className="flex items-center justify-center gap-2 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Use Template in Editor</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProjectsView({
  projects,
  onOpenProject,
  onCreateProject,
  onRefreshProjects,
}: {
  projects: Project[];
  onOpenProject: (p: Project) => void;
  onCreateProject: () => Promise<void>;
  onRefreshProjects: () => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [folder, setFolder] = useState('All');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');

  const folders = ['All', ...Array.from(new Set(projects.map((p) => p.folder)))];
  const filtered = projects.filter((p) => {
    const matchFolder = folder === 'All' || p.folder === folder;
    const matchSearch =
      !search.trim() ||
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase());
    return matchFolder && matchSearch;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-bold text-white">My Projects</h1>
        <button
          onClick={onCreateProject}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
        >
          <Plus className="w-4 h-4" />
          <span>New Project</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#11131B] border border-white/10 text-xs text-white"
          />
        </div>
        <div className="flex items-center gap-1 p-1 rounded-lg bg-[#11131B] border border-white/8">
          {folders.map((f) => (
            <button
              key={f}
              onClick={() => setFolder(f)}
              className={`px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap ${
                folder === f ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((p) => (
          <div
            key={p.id}
            className="p-4 rounded-xl bg-[#11131B] border border-white/8 flex flex-col justify-between space-y-4"
          >
            <div className="space-y-1.5">
              <div className="text-[11px] font-mono text-slate-400">
                {p.folder} · {p.aspectRatio} · v{p.version}
              </div>
              {renamingId === p.id ? (
                <div className="flex gap-2">
                  <input
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    className="flex-1 rounded bg-[#090A0F] border border-indigo-500 px-2 py-1 text-sm text-white"
                  />
                  <button
                    onClick={async () => {
                      await api.updateProject(p.id, { title: renameVal });
                      setRenamingId(null);
                      await onRefreshProjects();
                    }}
                    className="px-2.5 py-1 rounded bg-indigo-600 text-white text-xs"
                  >
                    Save
                  </button>
                </div>
              ) : (
                <h3 className="text-base font-semibold text-white truncate">{p.title}</h3>
              )}
              <p className="text-xs text-slate-400 line-clamp-2">
                {p.description || `${p.timeline.clips.length} timeline clips`}
              </p>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-white/6">
              <button
                onClick={() => onOpenProject(p)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Open</span>
              </button>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    setRenamingId(p.id);
                    setRenameVal(p.title);
                  }}
                  className="px-2 py-1 text-xs text-slate-400 hover:text-white"
                >
                  Rename
                </button>
                <button
                  onClick={async () => {
                    await api.duplicateProject(p.id);
                    await onRefreshProjects();
                  }}
                  className="p-1.5 text-slate-400 hover:text-white"
                  title="Duplicate"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={async () => {
                    await api.deleteProject(p.id);
                    await onRefreshProjects();
                  }}
                  className="p-1.5 text-slate-400 hover:text-rose-400"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function QueueAndExportsView({
  jobs,
  exportsList,
  onRefresh,
}: {
  jobs: GenerationJob[];
  exportsList: ExportJob[];
  onRefresh: () => Promise<void>;
}) {
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">
            Rendering Queue & Export History
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Verified resolution, codec, frame rate, and Native vs Upscaled 4K classification.
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#141722] border border-white/10 text-xs text-slate-200 hover:bg-[#1B1F2E]"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Export History */}
      <div className="p-5 rounded-xl bg-[#11131B] border border-white/8 space-y-3">
        <h2 className="text-sm font-semibold text-white">Video Exports ({exportsList.length})</h2>
        {exportsList.length === 0 ? (
          <p className="text-xs text-slate-500 py-4">
            No exports yet. Open any project in the Video Editor and click Export Video.
          </p>
        ) : (
          <div className="space-y-2.5">
            {exportsList.map((exp) => (
              <div
                key={exp.id}
                className="p-4 rounded-lg bg-[#090A0F] border border-white/8 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-1">
                  <div className="font-semibold text-white text-sm">{exp.projectTitle}</div>
                  <div className="font-mono text-slate-400 tabular-nums">
                    {exp.resolution} ({exp.aspectRatio}) · {exp.fps} FPS · {exp.format.toUpperCase()} /{' '}
                    {exp.codec.toUpperCase()} · Classification:{' '}
                    <span className="text-indigo-300">{exp.qualityClassification.replace('_', ' ')}</span>
                  </div>
                  {exp.status === 'completed' && (
                    <div className="text-emerald-400 font-mono tabular-nums">
                      Verified {exp.verifiedWidth}×{exp.verifiedHeight} · {exp.verifiedCodec} ·{' '}
                      {exp.outputSizeBytes ? `${(exp.outputSizeBytes / (1024 * 1024)).toFixed(2)} MB` : ''}
                    </div>
                  )}
                  {exp.status === 'failed' && (
                    <div className="text-rose-400">{exp.errorMessage}</div>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono tabular-nums text-slate-300 capitalize">
                    {exp.status} · {exp.progress}%
                  </span>
                  {exp.status === 'completed' && exp.downloadUrl && (
                    <a
                      href={exp.downloadUrl}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </a>
                  )}
                  {exp.status === 'failed' && (
                    <button
                      onClick={async () => {
                        await api.retryExport(exp.id);
                        await onRefresh();
                      }}
                      className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/15 text-white"
                    >
                      Retry
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Generation Queue */}
      <div className="p-5 rounded-xl bg-[#11131B] border border-white/8 space-y-3">
        <h2 className="text-sm font-semibold text-white">AI Generation Tasks ({jobs.length})</h2>
        {jobs.length === 0 ? (
          <p className="text-xs text-slate-500 py-4">No AI generation tasks queued.</p>
        ) : (
          <div className="space-y-2">
            {jobs.map((j) => (
              <div
                key={j.id}
                className="p-3 rounded-lg bg-[#090A0F] border border-white/8 flex items-center justify-between text-xs"
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-200 truncate">{j.prompt}</div>
                  <div className="font-mono text-slate-500">{j.modelId}</div>
                </div>
                <span className="font-mono tabular-nums text-slate-300 capitalize shrink-0 ml-3">
                  {j.status} · {j.progress}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function SettingsView({
  settings,
  language,
  onSave,
  onOpenAuth,
}: {
  settings: UserSettings | null;
  language: Language;
  onSave: (patch: Partial<UserSettings>) => Promise<void>;
  onOpenAuth: () => void;
}) {
  const [res, setRes] = useState<ExportResolution>(settings?.defaultResolution || '1080p');
  const [fps, setFps] = useState<number>(settings?.defaultFps || 30);
  const [aspect, setAspect] = useState<AspectRatio>(settings?.defaultAspectRatio || '16:9');
  const [savedNotice, setSavedNotice] = useState(false);

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <h1 className="font-display text-2xl font-bold text-white">Account & Studio Settings</h1>

      <div className="p-5 rounded-xl bg-[#11131B] border border-white/8 space-y-4 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-slate-400 mb-1">Default Resolution</label>
            <select
              value={res}
              onChange={(e) => setRes(e.target.value as ExportResolution)}
              className="w-full rounded-lg bg-[#090A0F] border border-white/10 px-3 py-2 text-white"
            >
              <option value="720p">720p HD</option>
              <option value="1080p">1080p Full HD</option>
              <option value="1440p">1440p 2K</option>
              <option value="2160p">2160p 4K UHD</option>
            </select>
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Default Frame Rate</label>
            <select
              value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
              className="w-full rounded-lg bg-[#090A0F] border border-white/10 px-3 py-2 text-white"
            >
              <option value={24}>24 FPS</option>
              <option value={30}>30 FPS</option>
              <option value={60}>60 FPS</option>
            </select>
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Default Aspect Ratio</label>
            <select
              value={aspect}
              onChange={(e) => setAspect(e.target.value as AspectRatio)}
              className="w-full rounded-lg bg-[#090A0F] border border-white/10 px-3 py-2 text-white"
            >
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
              <option value="4:5">4:5</option>
              <option value="21:9">21:9</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-white/8">
          <button
            onClick={onOpenAuth}
            className="px-3.5 py-2 rounded-lg bg-white/8 hover:bg-white/12 text-slate-200 font-medium"
          >
            Manage Sign-In / Account
          </button>
          <div className="flex items-center gap-3">
            {savedNotice && <span className="text-emerald-400">Preferences saved</span>}
            <button
              onClick={async () => {
                await onSave({
                  defaultResolution: res,
                  defaultFps: fps as 24 | 30 | 60,
                  defaultAspectRatio: aspect,
                  uiLanguage: language,
                });
                setSavedNotice(true);
                setTimeout(() => setSavedNotice(false), 2500);
              }}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold"
            >
              Save Defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
