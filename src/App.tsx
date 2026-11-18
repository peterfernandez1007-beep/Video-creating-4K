import { useCallback, useEffect, useState } from 'react';
import { AdminAndBillingView } from './components/AdminAndBillingView';
import { AiVideoToolsView } from './components/AiVideoToolsView';
import { AudioStudioView } from './components/AudioStudioView';
import { AuthModal } from './components/AuthModal';
import {
  HomeDashboardView,
  ProjectsView,
  QueueAndExportsView,
  SettingsView,
  TemplatesView,
} from './components/DashboardAndLibraryViews';
import { ImageStudioView } from './components/ImageStudioView';
import { MobileTopToggle, SidebarNav, type StudioRoute } from './components/SidebarNav';
import { TimelineEditor } from './components/TimelineEditor';
import { VideoGeneratorView } from './components/VideoGeneratorView';
import { t } from './i18n/translations';
import { api } from './lib/api';
import type {
  AIModelCapability,
  AIProvider,
  BillingSummary,
  ExportJob,
  GenerationJob,
  Language,
  MediaAsset,
  Project,
  SubtitleCue,
  TimelineClip,
  UserProfile,
  UserSettings,
} from './types/studio';

export default function App() {
  const [route, setRoute] = useState<StudioRoute>('home');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

  const [user, setUser] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [language, setLanguage] = useState<Language>('en');

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [models, setModels] = useState<AIModelCapability[]>([]);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [exportsList, setExportsList] = useState<ExportJob[]>([]);
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    try {
      const [meRes, projRes, mediaRes, regRes, jobsRes, expRes, billRes] = await Promise.all([
        api.getMe(),
        api.listProjects(),
        api.listMedia(),
        api.getRegistry(),
        api.listJobs(),
        api.listExports(),
        api.getBillingSummary(),
      ]);
      setUser(meRes.user);
      setSettings(meRes.settings);
      setLanguage(meRes.settings?.uiLanguage || meRes.user?.language || 'en');
      setProjects(projRes.projects);
      setActiveProject((prev) => {
        if (prev) {
          return projRes.projects.find((p) => p.id === prev.id) || projRes.projects[0] || null;
        }
        return projRes.projects[0] || null;
      });
      setMedia(mediaRes.media);
      setProviders(regRes.providers);
      setModels(regRes.models);
      setJobs(jobsRes.jobs);
      setExportsList(expRes.exports);
      setBilling(billRes);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Poll active background jobs or exports every 2 seconds
  useEffect(() => {
    const hasPending =
      jobs.some((j) => j.status === 'queued' || j.status === 'running') ||
      exportsList.some((e) => e.status === 'queued' || e.status === 'running');
    if (!hasPending) return;
    const timer = window.setInterval(async () => {
      const [jRes, eRes, mRes] = await Promise.all([
        api.listJobs(),
        api.listExports(),
        api.listMedia(),
      ]);
      setJobs(jRes.jobs);
      setExportsList(eRes.exports);
      setMedia(mRes.media);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [jobs, exportsList]);

  const handleToggleLanguage = async (lang: Language) => {
    setLanguage(lang);
    await api.updateSettings({ uiLanguage: lang }).catch(() => {});
  };

  const handleCreateProject = async () => {
    const res = await api.createProject({
      title: `Studio Project ${projects.length + 1}`,
      aspectRatio: settings?.defaultAspectRatio || '16:9',
      targetResolution: settings?.defaultResolution || '1080p',
      targetFps: settings?.defaultFps || 30,
    });
    setProjects((prev) => [res.project, ...prev]);
    setActiveProject(res.project);
    setRoute('editor');
  };

  const handleAddMediaToProject = async (asset: MediaAsset) => {
    let target = activeProject;
    if (!target) {
      const created = await api.createProject({ title: asset.title });
      target = created.project;
    }

    const track =
      target.timeline.tracks.find((tr) =>
        asset.kind === 'audio' ? tr.kind === 'audio' : tr.kind === 'video'
      ) || target.timeline.tracks[0];
    if (!track) return;

    const tail = target.timeline.clips
      .filter((c) => c.trackId === track.id)
      .reduce((m, c) => Math.max(m, c.startSec + c.durationSec), 0);
    const dur = asset.kind === 'image' ? 5 : Math.max(1, asset.durationSec || 5);

    const newClip: TimelineClip = {
      id: `clip-${Date.now()}`,
      trackId: track.id,
      mediaId: asset.id,
      kind: asset.kind,
      label: asset.title,
      startSec: Math.round(tail * 10) / 10,
      durationSec: Math.round(dur * 10) / 10,
      inSec: 0,
      outSec: Math.round(dur * 10) / 10,
      properties: {
        speed: 1,
        reverse: false,
        opacity: 1,
        brightness: 0,
        contrast: 1,
        saturation: 1,
        filter: 'none',
        transitionIn: 'none',
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
      },
    };

    const nextTimeline = {
      ...target.timeline,
      clips: [...target.timeline.clips, newClip],
    };
    const updated = await api.updateProject(target.id, { timeline: nextTimeline });
    setActiveProject(updated.project);
    setProjects((prev) => prev.map((p) => (p.id === updated.project.id ? updated.project : p)));
    setRoute('editor');
  };

  const handleApplySubtitles = async (cues: SubtitleCue[]) => {
    if (!activeProject) return;
    const nextTimeline = { ...activeProject.timeline, subtitles: cues };
    const updated = await api.updateProject(activeProject.id, { timeline: nextTimeline });
    setActiveProject(updated.project);
    setProjects((prev) => prev.map((p) => (p.id === updated.project.id ? updated.project : p)));
    setRoute('editor');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#090A0F] flex items-center justify-center text-sm text-slate-400">
        Loading AI Video Studio 4K...
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-[#090A0F] text-slate-100">
      <SidebarNav
        active={route}
        onSelect={setRoute}
        language={language}
        onToggleLanguage={handleToggleLanguage}
        user={user}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
        onOpenAuth={() => setAuthOpen(true)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <MobileTopToggle
          onOpen={() => setMobileOpen(true)}
          title={t(language, 'brand')}
          onPrimaryAction={() => setRoute('editor')}
          primaryLabel={t(language, 'openEditor')}
        />

        <main className="flex-1 min-w-0">
          {route === 'home' && (
            <HomeDashboardView
              projects={projects}
              media={media}
              exportsList={exportsList}
              language={language}
              onNavigate={setRoute}
              onOpenProject={(p) => {
                setActiveProject(p);
                setRoute('editor');
              }}
              onCreateProject={handleCreateProject}
            />
          )}

          {route === 'generator' && (
            <VideoGeneratorView
              models={models}
              media={media}
              jobs={jobs}
              activeProjectId={activeProject?.id || null}
              language={language}
              onRefreshJobs={async () => {
                const [jRes, mRes] = await Promise.all([api.listJobs(), api.listMedia()]);
                setJobs(jRes.jobs);
                setMedia(mRes.media);
              }}
              onMediaCreated={(asset) => setMedia((prev) => [asset, ...prev])}
              onAddToProject={handleAddMediaToProject}
            />
          )}

          {route === 'editor' && activeProject && (
            <TimelineEditor
              project={activeProject}
              media={media}
              language={language}
              onProjectChange={(updated) => {
                setActiveProject(updated);
                setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
              }}
              onMediaUploaded={(asset) => setMedia((prev) => [asset, ...prev])}
              onNavigateQueue={() => setRoute('queue')}
            />
          )}

          {route === 'tools' && (
            <AiVideoToolsView
              media={media}
              language={language}
              onMediaCreated={(asset) => setMedia((prev) => [asset, ...prev])}
              onAddToProject={handleAddMediaToProject}
            />
          )}

          {route === 'audio' && (
            <AudioStudioView
              media={media}
              language={language}
              onMediaCreated={(asset) => setMedia((prev) => [asset, ...prev])}
              onAddToProject={handleAddMediaToProject}
              onApplySubtitles={handleApplySubtitles}
            />
          )}

          {route === 'image' && (
            <ImageStudioView
              media={media}
              onMediaCreated={(asset) => setMedia((prev) => [asset, ...prev])}
              onAddToProject={handleAddMediaToProject}
              onSendToVideoGen={() => setRoute('generator')}
            />
          )}

          {route === 'templates' && (
            <TemplatesView
              onLaunchTemplate={async (tpl) => {
                const created = await api.createProject({
                  title: tpl.title,
                  folder: tpl.folder,
                  description: tpl.description,
                  aspectRatio: tpl.aspectRatio,
                  targetResolution: tpl.resolution,
                  timeline: {
                    tracks: [
                      { id: 'trk-v1', kind: 'video', name: 'Video 1 (Main)', orderIndex: 0, muted: false, locked: false, volume: 1 },
                      { id: 'trk-v2', kind: 'video', name: 'Video 2 (Overlay)', orderIndex: 1, muted: false, locked: false, volume: 1 },
                      { id: 'trk-t1', kind: 'text', name: 'Titles & Subtitles', orderIndex: 2, muted: false, locked: false, volume: 1 },
                      { id: 'trk-a1', kind: 'audio', name: 'Audio 1 (Voiceover)', orderIndex: 3, muted: false, locked: false, volume: 1 },
                      { id: 'trk-a2', kind: 'audio', name: 'Audio 2 (Music)', orderIndex: 4, muted: false, locked: false, volume: 0.7 },
                    ],
                    clips: [
                      {
                        id: `clip-${Date.now()}`,
                        trackId: 'trk-v1',
                        mediaId: tpl.mediaId,
                        kind: 'video',
                        label: tpl.title,
                        startSec: 0,
                        durationSec: 5,
                        inSec: 0,
                        outSec: 5,
                        properties: {
                          speed: 1,
                          reverse: false,
                          opacity: 1,
                          brightness: 0,
                          contrast: 1.06,
                          saturation: 1.05,
                          filter: 'cinema_warm',
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
                        },
                      },
                      {
                        id: `clip-txt-${Date.now()}`,
                        trackId: 'trk-t1',
                        mediaId: null,
                        kind: 'text',
                        label: 'Template Title',
                        startSec: 0.5,
                        durationSec: 4,
                        inSec: 0,
                        outSec: 4,
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
                          textContent: tpl.overlayText,
                          textColor: '#FFFFFF',
                          fontSize: 44,
                          textAnimation: 'fade_up',
                          textPosition: 'bottom',
                        },
                      },
                    ],
                    subtitles: [],
                  },
                });
                setProjects((prev) => [created.project, ...prev]);
                setActiveProject(created.project);
                setRoute('editor');
              }}
            />
          )}

          {route === 'projects' && (
            <ProjectsView
              projects={projects}
              onOpenProject={(p) => {
                setActiveProject(p);
                setRoute('editor');
              }}
              onCreateProject={handleCreateProject}
              onRefreshProjects={loadAll}
            />
          )}

          {route === 'queue' && (
            <QueueAndExportsView
              jobs={jobs}
              exportsList={exportsList}
              onRefresh={async () => {
                const [jRes, eRes] = await Promise.all([api.listJobs(), api.listExports()]);
                setJobs(jRes.jobs);
                setExportsList(eRes.exports);
              }}
            />
          )}

          {route === 'admin' && (
            <AdminAndBillingView
              user={user}
              providers={providers}
              models={models}
              billing={billing}
              onRefresh={loadAll}
            />
          )}

          {route === 'settings' && (
            <SettingsView
              settings={settings}
              language={language}
              onSave={async (patch) => {
                await api.updateSettings(patch);
                await loadAll();
              }}
              onOpenAuth={() => setAuthOpen(true)}
            />
          )}
        </main>
      </div>

      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        user={user}
        language={language}
        onSuccess={loadAll}
      />
    </div>
  );
}
