import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Film,
  History,
  Lock,
  Merge,
  Music,
  Pause,
  Play,
  Plus,
  Redo2,
  Save,
  Scissors,
  Trash2,
  Type as TypeIcon,
  Undo2,
  Unlock,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n/translations';
import { api } from '../lib/api';
import type {
  AspectRatio,
  ClipProperties,
  ExportCodec,
  ExportFormat,
  ExportJob,
  ExportResolution,
  Language,
  MediaAsset,
  Project,
  ProjectVersion,
  TimelineClip,
  TimelineState,
} from '../types/studio';

interface TimelineEditorProps {
  project: Project;
  media: MediaAsset[];
  language: Language;
  onProjectChange: (updated: Project) => void;
  onMediaUploaded: (asset: MediaAsset) => void;
  onNavigateQueue: () => void;
}

const DEFAULT_PROPS: ClipProperties = {
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
};

function formatTimecode(sec: number, fps = 30): string {
  const s = Math.max(0, sec);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = Math.floor(s % 60);
  const frames = Math.floor((s % 1) * fps);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)}:${pad(frames)}`;
}

export function TimelineEditor({
  project,
  media,
  language,
  onProjectChange,
  onMediaUploaded,
  onNavigateQueue,
}: TimelineEditorProps) {
  const [timeline, setTimeline] = useState<TimelineState>(project.timeline);
  const [undoStack, setUndoStack] = useState<TimelineState[]>([]);
  const [redoStack, setRedoStack] = useState<TimelineState[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(
    project.timeline.clips[0]?.id ?? null
  );
  const [playheadSec, setPlayheadSec] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [pxPerSec, setPxPerSec] = useState(44);
  const [mediaFilter, setMediaFilter] = useState<'all' | 'video' | 'image' | 'audio'>('all');
  const [inspectorTab, setInspectorTab] = useState<'transform' | 'color' | 'effects' | 'text'>(
    'transform'
  );
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('saved');
  const [showExportModal, setShowExportModal] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Export configuration state
  const [expResolution, setExpResolution] = useState<ExportResolution>(project.targetResolution);
  const [expAspect, setExpAspect] = useState<AspectRatio>(project.aspectRatio);
  const [expFps, setExpFps] = useState<number>(project.targetFps);
  const [expFormat, setExpFormat] = useState<ExportFormat>('mp4');
  const [expCodec, setExpCodec] = useState<ExportCodec>('h264');
  const [activeExport, setActiveExport] = useState<ExportJob | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const dragStateRef = useRef<{
    clipId: string;
    mode: 'move' | 'trim_left' | 'trim_right';
    startX: number;
    origStart: number;
    origDuration: number;
    origIn: number;
  } | null>(null);

  // Sync when switching project
  useEffect(() => {
    setTimeline(project.timeline);
    setUndoStack([]);
    setRedoStack([]);
    setSelectedClipId(project.timeline.clips[0]?.id ?? null);
    setPlayheadSec(0);
    setIsPlaying(false);
    setExpResolution(project.targetResolution);
    setExpAspect(project.aspectRatio);
    setExpFps(project.targetFps);
  }, [project.id]);

  const mediaById = useMemo(() => {
    const m = new Map<string, MediaAsset>();
    for (const item of media) m.set(item.id, item);
    return m;
  }, [media]);

  const totalDuration = useMemo(() => {
    const maxClip = timeline.clips.reduce((acc, c) => Math.max(acc, c.startSec + c.durationSec), 0);
    return Math.max(12, Math.ceil(maxClip + 4));
  }, [timeline.clips]);

  const commitTimeline = useCallback(
    (next: TimelineState) => {
      setUndoStack((prev) => [...prev.slice(-29), timeline]);
      setRedoStack([]);
      setTimeline(next);
      setSaveState('saving');
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = window.setTimeout(async () => {
        try {
          const res = await api.updateProject(project.id, {
            timeline: next,
            aspectRatio: expAspect,
            targetResolution: expResolution,
          });
          onProjectChange(res.project);
          setSaveState('saved');
        } catch (err) {
          setErrorMsg(err instanceof Error ? err.message : 'Autosave failed');
        }
      }, 900);
    },
    [timeline, project.id, expAspect, expResolution, onProjectChange]
  );

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack((r) => [...r, timeline]);
    setUndoStack((u) => u.slice(0, -1));
    setTimeline(prev);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((u) => [...u, timeline]);
    setRedoStack((r) => r.slice(0, -1));
    setTimeline(next);
  };

  const handleSaveVersion = async () => {
    setSaveState('saving');
    try {
      const label = `Checkpoint v${project.version + 1}`;
      const res = await api.updateProject(project.id, {
        timeline,
        aspectRatio: expAspect,
        targetResolution: expResolution,
        targetFps: expFps as 24 | 30 | 60,
        versionLabel: label,
      });
      onProjectChange(res.project);
      setSaveState('saved');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const loadVersions = async () => {
    try {
      const res = await api.listVersions(project.id);
      setVersions(res.versions);
      setShowVersions(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed loading versions');
    }
  };

  // Playback loop
  useEffect(() => {
    if (!isPlaying) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setPlayheadSec((prev) => {
        const next = prev + dt;
        const end = timeline.clips.reduce((m, c) => Math.max(m, c.startSec + c.durationSec), 6);
        if (next >= end) {
          setIsPlaying(false);
          return 0;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, timeline.clips]);

  // Active clips at playhead
  const activeVisualClip = useMemo(() => {
    const vTracks = timeline.tracks
      .filter((tr) => tr.kind === 'video' && !tr.muted)
      .sort((a, b) => b.orderIndex - a.orderIndex);
    for (const tr of vTracks) {
      const found = timeline.clips.find(
        (c) =>
          c.trackId === tr.id &&
          (c.kind === 'video' || c.kind === 'image') &&
          playheadSec >= c.startSec &&
          playheadSec <= c.startSec + c.durationSec
      );
      if (found) return found;
    }
    return null;
  }, [timeline, playheadSec]);

  const activeTextClips = useMemo(
    () =>
      timeline.clips.filter(
        (c) =>
          c.kind === 'text' &&
          playheadSec >= c.startSec &&
          playheadSec <= c.startSec + c.durationSec
      ),
    [timeline.clips, playheadSec]
  );

  const activeSubtitle = useMemo(
    () =>
      (timeline.subtitles ?? []).find(
        (s) => playheadSec >= s.startSec && playheadSec <= s.endSec
      ) ?? null,
    [timeline.subtitles, playheadSec]
  );

  const activeAudioClip = useMemo(() => {
    const aTracks = new Set(timeline.tracks.filter((tr) => tr.kind === 'audio' && !tr.muted).map((t) => t.id));
    return (
      timeline.clips.find(
        (c) =>
          c.kind === 'audio' &&
          aTracks.has(c.trackId) &&
          playheadSec >= c.startSec &&
          playheadSec <= c.startSec + c.durationSec
      ) ?? null
    );
  }, [timeline, playheadSec]);

  const activeVisualAsset = activeVisualClip?.mediaId
    ? mediaById.get(activeVisualClip.mediaId) ?? null
    : null;
  const activeAudioAsset = activeAudioClip?.mediaId
    ? mediaById.get(activeAudioClip.mediaId) ?? null
    : null;

  // Sync HTML5 video/audio element to playhead
  useEffect(() => {
    const vid = videoRef.current;
    if (vid && activeVisualClip && activeVisualAsset?.kind === 'video') {
      const offset =
        activeVisualClip.inSec +
        (playheadSec - activeVisualClip.startSec) * (activeVisualClip.properties.speed || 1);
      if (Math.abs(vid.currentTime - offset) > 0.25) {
        vid.currentTime = Math.max(0, offset);
      }
      vid.playbackRate = Math.min(4, Math.max(0.25, activeVisualClip.properties.speed || 1));
      if (isPlaying && vid.paused) vid.play().catch(() => {});
      if (!isPlaying && !vid.paused) vid.pause();
    } else if (vid && !vid.paused) {
      vid.pause();
    }
  }, [activeVisualClip, activeVisualAsset, playheadSec, isPlaying]);

  useEffect(() => {
    const aud = audioRef.current;
    if (aud && activeAudioClip && activeAudioAsset) {
      const offset = activeAudioClip.inSec + (playheadSec - activeAudioClip.startSec);
      if (Math.abs(aud.currentTime - offset) > 0.3) {
        aud.currentTime = Math.max(0, offset);
      }
      aud.volume = Math.min(1, Math.max(0, activeAudioClip.properties.volume ?? 1));
      if (isPlaying && aud.paused) aud.play().catch(() => {});
      if (!isPlaying && !aud.paused) aud.pause();
    } else if (aud && !aud.paused) {
      aud.pause();
    }
  }, [activeAudioClip, activeAudioAsset, playheadSec, isPlaying]);

  // Global mouse handlers for timeline clip drag/trim
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const st = dragStateRef.current;
      if (!st) return;
      const dx = e.clientX - st.startX;
      const dt = dx / pxPerSec;

      setTimeline((prev) => ({
        ...prev,
        clips: prev.clips.map((c) => {
          if (c.id !== st.clipId) return c;
          if (st.mode === 'move') {
            return { ...c, startSec: Math.max(0, Math.round((st.origStart + dt) * 10) / 10) };
          }
          if (st.mode === 'trim_right') {
            const nextDur = Math.max(0.5, Math.round((st.origDuration + dt) * 10) / 10);
            return { ...c, durationSec: nextDur, outSec: c.inSec + nextDur * (c.properties.speed || 1) };
          }
          // trim_left
          const shift = Math.min(st.origDuration - 0.5, Math.max(-st.origStart, dt));
          const nextStart = Math.round((st.origStart + shift) * 10) / 10;
          const nextDur = Math.max(0.5, Math.round((st.origDuration - shift) * 10) / 10);
          const nextIn = Math.max(0, Math.round((st.origIn + shift) * 10) / 10);
          return { ...c, startSec: nextStart, durationSec: nextDur, inSec: nextIn };
        }),
      }));
    };
    const onUp = () => {
      if (dragStateRef.current) {
        dragStateRef.current = null;
        commitTimeline(timeline);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [pxPerSec, commitTimeline, timeline]);

  const addMediaClip = (asset: MediaAsset, targetTrackId?: string) => {
    const track =
      (targetTrackId && timeline.tracks.find((tr) => tr.id === targetTrackId)) ||
      timeline.tracks.find((tr) =>
        asset.kind === 'audio' ? tr.kind === 'audio' : tr.kind === 'video'
      ) ||
      timeline.tracks[0];
    if (!track) return;

    const trackClips = timeline.clips.filter((c) => c.trackId === track.id);
    const tailSec = trackClips.reduce((m, c) => Math.max(m, c.startSec + c.durationSec), 0);
    const dur = asset.kind === 'image' ? 5 : Math.max(1, asset.durationSec || 5);

    const newClip: TimelineClip = {
      id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      trackId: track.id,
      mediaId: asset.id,
      kind: asset.kind,
      label: asset.title,
      startSec: Math.round(tailSec * 10) / 10,
      durationSec: Math.round(dur * 10) / 10,
      inSec: 0,
      outSec: Math.round(dur * 10) / 10,
      properties: { ...DEFAULT_PROPS },
    };
    commitTimeline({ ...timeline, clips: [...timeline.clips, newClip] });
    setSelectedClipId(newClip.id);
  };

  const addTextOverlay = () => {
    const track = timeline.tracks.find((tr) => tr.kind === 'text') || timeline.tracks[0];
    if (!track) return;
    const newClip: TimelineClip = {
      id: `clip-txt-${Date.now()}`,
      trackId: track.id,
      mediaId: null,
      kind: 'text',
      label: 'Title Overlay',
      startSec: Math.round(playheadSec * 10) / 10,
      durationSec: 4,
      inSec: 0,
      outSec: 4,
      properties: {
        ...DEFAULT_PROPS,
        textContent: 'Studio Title Overlay',
        textColor: '#FFFFFF',
        fontSize: 44,
        textAnimation: 'fade_up',
        textPosition: 'bottom',
      },
    };
    commitTimeline({ ...timeline, clips: [...timeline.clips, newClip] });
    setSelectedClipId(newClip.id);
    setInspectorTab('text');
  };

  const selectedClip = useMemo(
    () => timeline.clips.find((c) => c.id === selectedClipId) ?? null,
    [timeline.clips, selectedClipId]
  );

  const updateSelectedClip = (patch: Partial<TimelineClip> & { propPatch?: Partial<ClipProperties> }) => {
    if (!selectedClip) return;
    const nextClips = timeline.clips.map((c) => {
      if (c.id !== selectedClip.id) return c;
      return {
        ...c,
        ...patch,
        properties: patch.propPatch ? { ...c.properties, ...patch.propPatch } : c.properties,
      };
    });
    commitTimeline({ ...timeline, clips: nextClips });
  };

  const splitSelectedAtPlayhead = () => {
    if (!selectedClip) return;
    if (
      playheadSec <= selectedClip.startSec + 0.2 ||
      playheadSec >= selectedClip.startSec + selectedClip.durationSec - 0.2
    ) {
      setErrorMsg('Move the playhead inside the selected clip before splitting.');
      return;
    }
    const leftDur = Math.round((playheadSec - selectedClip.startSec) * 10) / 10;
    const rightDur = Math.round((selectedClip.durationSec - leftDur) * 10) / 10;
    const splitMediaPoint = selectedClip.inSec + leftDur * (selectedClip.properties.speed || 1);

    const leftClip: TimelineClip = {
      ...selectedClip,
      durationSec: leftDur,
      outSec: splitMediaPoint,
    };
    const rightClip: TimelineClip = {
      ...selectedClip,
      id: `clip-${Date.now()}-split`,
      label: `${selectedClip.label} (Part 2)`,
      startSec: playheadSec,
      durationSec: rightDur,
      inSec: splitMediaPoint,
      outSec: selectedClip.outSec,
    };
    const nextClips = timeline.clips.flatMap((c) =>
      c.id === selectedClip.id ? [leftClip, rightClip] : [c]
    );
    commitTimeline({ ...timeline, clips: nextClips });
    setSelectedClipId(rightClip.id);
  };

  const mergeWithNextClip = () => {
    if (!selectedClip) return;
    const sameTrack = timeline.clips
      .filter((c) => c.trackId === selectedClip.trackId && c.startSec > selectedClip.startSec)
      .sort((a, b) => a.startSec - b.startSec);
    const neighbor = sameTrack[0];
    if (!neighbor || neighbor.mediaId !== selectedClip.mediaId) {
      setErrorMsg('Select a clip immediately followed by another segment from the same media to merge.');
      return;
    }
    const merged: TimelineClip = {
      ...selectedClip,
      durationSec: Math.round((selectedClip.durationSec + neighbor.durationSec) * 10) / 10,
      outSec: neighbor.outSec,
    };
    commitTimeline({
      ...timeline,
      clips: timeline.clips
        .filter((c) => c.id !== neighbor.id)
        .map((c) => (c.id === selectedClip.id ? merged : c)),
    });
  };

  const deleteSelectedClip = () => {
    if (!selectedClip) return;
    commitTimeline({
      ...timeline,
      clips: timeline.clips.filter((c) => c.id !== selectedClip.id),
    });
    setSelectedClipId(null);
  };

  const duplicateSelectedClip = () => {
    if (!selectedClip) return;
    const copy: TimelineClip = {
      ...selectedClip,
      id: `clip-dup-${Date.now()}`,
      label: `${selectedClip.label} (Copy)`,
      startSec: Math.round((selectedClip.startSec + selectedClip.durationSec) * 10) / 10,
    };
    commitTimeline({ ...timeline, clips: [...timeline.clips, copy] });
    setSelectedClipId(copy.id);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setErrorMsg(null);
    try {
      const res = await api.uploadMedia(file, file.name, project.id);
      onMediaUploaded(res.media);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  // Native vs Upscaled 4K check
  const exportQualitySummary = useMemo(() => {
    const visualIds = new Set(
      timeline.clips.filter((c) => c.kind === 'video' || c.kind === 'image').map((c) => c.mediaId)
    );
    const assets = Array.from(visualIds)
      .map((id) => (id ? mediaById.get(id) : undefined))
      .filter((a): a is MediaAsset => Boolean(a));
    if (expResolution !== '2160p') {
      return {
        isNative4k: false,
        label: `Standard ${expResolution} Output`,
        detail: 'Matched to selected resolution and aspect ratio.',
      };
    }
    const all4k = assets.length > 0 && assets.every((a) => a.width >= 3840 || a.height >= 2160);
    return all4k
      ? {
          isNative4k: true,
          label: 'Native 4K UHD (3840×2160)',
          detail: 'All timeline video/image sources meet native 4K pixel dimensions.',
        }
      : {
          isNative4k: false,
          label: 'Upscaled 4K (FFmpeg Lanczos)',
          detail:
            'Source clips are below 3840px wide. Output will be cleanly upscaled to 2160p and labeled Upscaled 4K.',
        };
  }, [timeline.clips, mediaById, expResolution]);

  const handleStartExport = async () => {
    setErrorMsg(null);
    try {
      // Save latest timeline before export
      await api.updateProject(project.id, {
        timeline,
        aspectRatio: expAspect,
        targetResolution: expResolution,
        targetFps: expFps as 24 | 30 | 60,
      });
      const res = await api.startExport({
        projectId: project.id,
        resolution: expResolution,
        aspectRatio: expAspect,
        fps: expFps,
        format: expFormat,
        codec: expCodec,
      });
      const poll = async () => {
        const list = await api.listExports();
        const found = list.exports.find((x) => x.id === res.exportId) ?? null;
        setActiveExport(found);
        if (found && (found.status === 'queued' || found.status === 'running')) {
          setTimeout(poll, 1200);
        }
      };
      poll();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Export failed to start');
    }
  };

  // Visual preview CSS filter for active clip
  const previewFilterStyle = useMemo(() => {
    if (!activeVisualClip) return {};
    const p = activeVisualClip.properties;
    const bright = 1 + (p.brightness || 0);
    const con = p.contrast || 1;
    const sat = p.filter === 'noir_bw' ? 0 : p.saturation ?? 1;
    const sepia = p.filter === 'vintage' ? 0.45 : p.filter === 'cinema_warm' ? 0.18 : 0;
    const hue = p.filter === 'teal_orange' ? '-8deg' : '0deg';
    return {
      filter: `brightness(${bright}) contrast(${con}) saturate(${sat}) sepia(${sepia}) hue-rotate(${hue})`,
      opacity: p.opacity ?? 1,
      transform: `scale(${p.scale || 1}) rotate(${p.rotationDeg || 0}deg)`,
    };
  }, [activeVisualClip]);

  const filteredMedia = useMemo(
    () => (mediaFilter === 'all' ? media : media.filter((m) => m.kind === mediaFilter)),
    [media, mediaFilter]
  );

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] lg:h-screen bg-[#090A0F] text-slate-100 overflow-hidden">
      {/* Top Studio Bar */}
      <div className="flex items-center justify-between gap-4 px-4 py-2.5 bg-[#0D0F16] border-b border-white/8 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <input
            value={project.title}
            onChange={(e) => onProjectChange({ ...project, title: e.target.value })}
            onBlur={() => api.updateProject(project.id, { title: project.title })}
            className="bg-transparent text-sm font-semibold text-white border border-transparent hover:border-white/10 focus:border-indigo-500 rounded px-2 py-1 focus:outline-none truncate max-w-[220px]"
            aria-label="Project title"
          />
          <span className="hidden sm:inline text-xs text-slate-400 whitespace-nowrap">
            v{project.version} · {saveState === 'saving' ? t(language, 'saving') : t(language, 'autosaveReady')}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            className="p-2 rounded-lg text-slate-300 hover:bg-white/5 disabled:opacity-35"
            title={t(language, 'undo')}
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            className="p-2 rounded-lg text-slate-300 hover:bg-white/5 disabled:opacity-35"
            title={t(language, 'redo')}
          >
            <Redo2 className="w-4 h-4" />
          </button>
          <button
            onClick={loadVersions}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:bg-white/5 border border-white/8 whitespace-nowrap shrink-0"
          >
            <History className="w-3.5 h-3.5" />
            <span>History</span>
          </button>
          <button
            onClick={handleSaveVersion}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-200 bg-[#171B26] hover:bg-[#1F2433] border border-white/10 whitespace-nowrap shrink-0"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{t(language, 'saveProject')}</span>
          </button>
          <button
            onClick={() => setShowExportModal(true)}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{t(language, 'exportVideo')}</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center justify-between px-4 py-2 bg-rose-950/60 border-b border-rose-500/30 text-xs text-rose-200">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-rose-300 hover:text-white">
            Dismiss
          </button>
        </div>
      )}

      {/* Main 3-Pane Editor Workspace */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-hidden">
        {/* Left: Media Bin */}
        <div className="hidden lg:flex lg:col-span-3 flex-col border-r border-white/8 bg-[#0D0F16] min-h-0">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/8">
            <span className="text-xs font-semibold text-slate-200">Media Library</span>
            <label className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-xs font-medium cursor-pointer whitespace-nowrap shrink-0">
              <Upload className="w-3.5 h-3.5" />
              <span>{uploading ? 'Uploading...' : 'Import'}</span>
              <input
                type="file"
                accept="video/*,image/*,audio/*"
                className="hidden"
                onChange={handleFileUpload}
              />
            </label>
          </div>

          <div className="flex items-center gap-1 p-2 border-b border-white/8">
            {(['all', 'video', 'image', 'audio'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setMediaFilter(k)}
                className={`flex-1 py-1 text-[11px] font-medium rounded capitalize transition-colors ${
                  mediaFilter === k
                    ? 'bg-white/10 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {k}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
            {filteredMedia.map((item) => (
              <div
                key={item.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/media-id', item.id)}
                className="group flex items-center gap-2.5 p-2 rounded-lg bg-[#141722] hover:bg-[#191D2B] border border-white/6 transition-colors"
              >
                <div className="w-14 h-10 rounded bg-black/60 overflow-hidden shrink-0 flex items-center justify-center">
                  {item.thumbnailUrl ? (
                    <img
                      src={item.thumbnailUrl}
                      alt={item.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : item.kind === 'audio' ? (
                    <Music className="w-4 h-4 text-indigo-400" />
                  ) : (
                    <Film className="w-4 h-4 text-slate-500" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-slate-200 truncate">{item.title}</div>
                  <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                    {item.kind === 'audio'
                      ? `${item.durationSec.toFixed(1)}s`
                      : `${item.width}×${item.height} · ${item.durationSec.toFixed(1)}s`}
                  </div>
                </div>
                <button
                  onClick={() => addMediaClip(item)}
                  className="p-1.5 rounded bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white transition-colors shrink-0"
                  title="Add to timeline"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Center: Preview Player */}
        <div className="lg:col-span-6 flex flex-col bg-[#07080C] min-h-0">
          <div className="flex-1 flex items-center justify-center p-4 min-h-0 relative overflow-hidden">
            <div
              className="relative bg-black border border-white/10 rounded-lg overflow-hidden shadow-2xl flex items-center justify-center max-h-full max-w-full"
              style={{
                aspectRatio: expAspect.replace(':', '/'),
                height: expAspect === '9:16' || expAspect === '4:5' ? '100%' : 'auto',
                width: expAspect === '9:16' || expAspect === '4:5' ? 'auto' : '100%',
              }}
            >
              {activeVisualAsset ? (
                activeVisualAsset.kind === 'video' ? (
                  <video
                    ref={videoRef}
                    src={activeVisualAsset.url}
                    muted={timeline.tracks.find((tr) => tr.id === activeVisualClip?.trackId)?.muted}
                    playsInline
                    className="w-full h-full object-contain transition-transform duration-75"
                    style={previewFilterStyle}
                  />
                ) : (
                  <img
                    src={activeVisualAsset.url}
                    alt={activeVisualAsset.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-contain"
                    style={previewFilterStyle}
                  />
                )
              ) : (
                <div className="text-center px-6">
                  <Film className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <p className="text-xs text-slate-500">
                    Add video or image clips to the timeline to preview
                  </p>
                </div>
              )}

              {/* Live Text Overlays */}
              {activeTextClips.map((tc) => (
                <div
                  key={tc.id}
                  className={`absolute left-4 right-4 flex justify-center pointer-events-none ${
                    tc.properties.textPosition === 'top'
                      ? 'top-6'
                      : tc.properties.textPosition === 'center'
                        ? 'top-1/2 -translate-y-1/2'
                        : 'bottom-10'
                  }`}
                >
                  <span
                    className="px-4 py-1.5 rounded bg-black/60 font-semibold text-center"
                    style={{
                      color: tc.properties.textColor || '#FFFFFF',
                      fontSize: `${Math.max(14, Math.round((tc.properties.fontSize || 42) * 0.45))}px`,
                    }}
                  >
                    {tc.properties.textContent}
                  </span>
                </div>
              ))}

              {/* Live Subtitles */}
              {activeSubtitle && (
                <div className="absolute bottom-4 left-6 right-6 flex justify-center pointer-events-none">
                  <span className="px-3 py-1 rounded bg-black/75 text-white text-sm font-medium text-center">
                    {activeSubtitle.text}
                  </span>
                </div>
              )}
            </div>

            {activeAudioAsset && (
              <audio ref={audioRef} src={activeAudioAsset.url} className="hidden" />
            )}
          </div>

          {/* Transport Controls */}
          <div className="flex items-center justify-between px-4 py-2 bg-[#0D0F16] border-t border-white/8 shrink-0">
            <div className="font-mono text-xs text-slate-300 tabular-nums">
              {formatTimecode(playheadSec, expFps)} / {formatTimecode(totalDuration, expFps)}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPlayheadSec((p) => Math.max(0, p - 1 / expFps))}
                className="p-1.5 rounded hover:bg-white/5 text-slate-300"
                title="Previous frame"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setIsPlaying((p) => !p)}
                className="p-2 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white"
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setPlayheadSec((p) => Math.min(totalDuration, p + 1 / expFps))}
                className="p-1.5 rounded hover:bg-white/5 text-slate-300"
                title="Next frame"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>{expAspect}</span>
              <span>·</span>
              <span className="font-mono tabular-nums">{expFps} FPS</span>
            </div>
          </div>
        </div>

        {/* Right: Properties Inspector */}
        <div className="hidden lg:flex lg:col-span-3 flex-col border-l border-white/8 bg-[#0D0F16] min-h-0">
          <div className="flex items-center gap-1 p-2 border-b border-white/8">
            {(
              [
                ['transform', 'Transform'],
                ['color', 'Color'],
                ['effects', 'FX & Keys'],
                ['text', 'Text'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setInspectorTab(id)}
                className={`flex-1 py-1.5 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                  inspectorTab === id ? 'bg-indigo-600/25 text-indigo-300' : 'text-slate-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
            {!selectedClip ? (
              <div className="text-slate-500 py-8 text-center">
                Select a clip on the timeline to inspect trim, speed, color grading, keyframes, or text.
              </div>
            ) : (
              <>
                <div className="pb-2 border-b border-white/8">
                  <div className="font-semibold text-slate-200 truncate">{selectedClip.label}</div>
                  <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
                    Start {selectedClip.startSec.toFixed(1)}s · Dur {selectedClip.durationSec.toFixed(1)}s
                  </div>
                </div>

                {inspectorTab === 'transform' && (
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-slate-300 mb-1">
                        <span>Speed (Slow-Mo / Fast)</span>
                        <span className="font-mono tabular-nums">{selectedClip.properties.speed}x</span>
                      </div>
                      <input
                        type="range"
                        min={0.25}
                        max={4}
                        step={0.25}
                        value={selectedClip.properties.speed}
                        onChange={(e) =>
                          updateSelectedClip({ propPatch: { speed: Number(e.target.value) } })
                        }
                        className="w-full accent-indigo-500"
                      />
                      <div className="flex gap-1.5 mt-1.5">
                        {[0.5, 1, 1.5, 2].map((sp) => (
                          <button
                            key={sp}
                            onClick={() => updateSelectedClip({ propPatch: { speed: sp } })}
                            className={`flex-1 py-1 rounded border text-[11px] font-mono ${
                              selectedClip.properties.speed === sp
                                ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200'
                                : 'border-white/10 text-slate-400'
                            }`}
                          >
                            {sp}x
                          </button>
                        ))}
                      </div>
                    </div>

                    <label className="flex items-center justify-between py-1">
                      <span className="text-slate-300">Reverse Playback</span>
                      <input
                        type="checkbox"
                        checked={selectedClip.properties.reverse}
                        onChange={(e) =>
                          updateSelectedClip({ propPatch: { reverse: e.target.checked } })
                        }
                        className="accent-indigo-500"
                      />
                    </label>

                    <div>
                      <div className="flex justify-between text-slate-300 mb-1">
                        <span>Scale / Zoom</span>
                        <span className="font-mono tabular-nums">{selectedClip.properties.scale.toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min={0.5}
                        max={2.5}
                        step={0.05}
                        value={selectedClip.properties.scale}
                        onChange={(e) =>
                          updateSelectedClip({ propPatch: { scale: Number(e.target.value) } })
                        }
                        className="w-full accent-indigo-500"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-slate-300 mb-1">
                        <span>Rotation</span>
                        <span className="font-mono tabular-nums">{selectedClip.properties.rotationDeg}°</span>
                      </div>
                      <input
                        type="range"
                        min={-180}
                        max={180}
                        step={5}
                        value={selectedClip.properties.rotationDeg}
                        onChange={(e) =>
                          updateSelectedClip({ propPatch: { rotationDeg: Number(e.target.value) } })
                        }
                        className="w-full accent-indigo-500"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-slate-300 mb-1">
                        <span>Audio Volume</span>
                        <span className="font-mono tabular-nums">{Math.round(selectedClip.properties.volume * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.1}
                        value={selectedClip.properties.volume}
                        onChange={(e) =>
                          updateSelectedClip({ propPatch: { volume: Number(e.target.value) } })
                        }
                        className="w-full accent-indigo-500"
                      />
                    </div>
                  </div>
                )}

                {inspectorTab === 'color' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-slate-300 mb-1.5">Color Grade Preset</label>
                      <select
                        value={selectedClip.properties.filter}
                        onChange={(e) =>
                          updateSelectedClip({
                            propPatch: {
                              filter: e.target.value as ClipProperties['filter'],
                            },
                          })
                        }
                        className="w-full bg-[#151824] border border-white/10 rounded-lg px-2.5 py-2 text-slate-200"
                      >
                        <option value="none">Natural (None)</option>
                        <option value="cinema_warm">Cinema Warm</option>
                        <option value="teal_orange">Teal & Orange</option>
                        <option value="noir_bw">Noir Black & White</option>
                        <option value="vintage">Vintage Film</option>
                      </select>
                    </div>
                    <div>
                      <div className="flex justify-between text-slate-300 mb-1">
                        <span>Brightness</span>
                        <span className="font-mono tabular-nums">{selectedClip.properties.brightness.toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min={-0.4}
                        max={0.4}
                        step={0.05}
                        value={selectedClip.properties.brightness}
                        onChange={(e) =>
                          updateSelectedClip({ propPatch: { brightness: Number(e.target.value) } })
                        }
                        className="w-full accent-indigo-500"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-slate-300 mb-1">
                        <span>Contrast</span>
                        <span className="font-mono tabular-nums">{selectedClip.properties.contrast.toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min={0.6}
                        max={1.8}
                        step={0.05}
                        value={selectedClip.properties.contrast}
                        onChange={(e) =>
                          updateSelectedClip({ propPatch: { contrast: Number(e.target.value) } })
                        }
                        className="w-full accent-indigo-500"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-slate-300 mb-1">
                        <span>Saturation</span>
                        <span className="font-mono tabular-nums">{selectedClip.properties.saturation.toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.05}
                        value={selectedClip.properties.saturation}
                        onChange={(e) =>
                          updateSelectedClip({ propPatch: { saturation: Number(e.target.value) } })
                        }
                        className="w-full accent-indigo-500"
                      />
                    </div>
                  </div>
                )}

                {inspectorTab === 'effects' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-slate-300 mb-1.5">Transition In</label>
                      <select
                        value={selectedClip.properties.transitionIn}
                        onChange={(e) =>
                          updateSelectedClip({
                            propPatch: {
                              transitionIn: e.target.value as ClipProperties['transitionIn'],
                            },
                          })
                        }
                        className="w-full bg-[#151824] border border-white/10 rounded-lg px-2.5 py-2 text-slate-200"
                      >
                        <option value="none">None (Hard Cut)</option>
                        <option value="fade">Fade In</option>
                        <option value="crossfade">Crossfade</option>
                        <option value="wipe">Directional Wipe</option>
                      </select>
                    </div>

                    <div className="pt-2 border-t border-white/8 space-y-2">
                      <label className="flex items-center justify-between">
                        <span className="text-slate-300 font-medium">Chroma Key (Green Screen)</span>
                        <input
                          type="checkbox"
                          checked={selectedClip.properties.chromaKeyEnabled}
                          onChange={(e) =>
                            updateSelectedClip({
                              propPatch: { chromaKeyEnabled: e.target.checked },
                            })
                          }
                          className="accent-indigo-500"
                        />
                      </label>
                      {selectedClip.properties.chromaKeyEnabled && (
                        <div className="flex items-center gap-3">
                          <input
                            type="color"
                            value={selectedClip.properties.chromaKeyColor}
                            onChange={(e) =>
                              updateSelectedClip({
                                propPatch: { chromaKeyColor: e.target.value },
                              })
                            }
                            className="w-8 h-8 rounded bg-transparent border border-white/10"
                          />
                          <input
                            type="range"
                            min={0.05}
                            max={0.6}
                            step={0.05}
                            value={selectedClip.properties.chromaKeySimilarity}
                            onChange={(e) =>
                              updateSelectedClip({
                                propPatch: { chromaKeySimilarity: Number(e.target.value) },
                              })
                            }
                            className="flex-1 accent-indigo-500"
                          />
                        </div>
                      )}
                    </div>

                    <div className="pt-2 border-t border-white/8 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300 font-medium">Keyframes</span>
                        <button
                          onClick={() => {
                            const offset = Math.max(
                              0,
                              Math.round((playheadSec - selectedClip.startSec) * 10) / 10
                            );
                            const existing = selectedClip.properties.keyframes ?? [];
                            updateSelectedClip({
                              propPatch: {
                                keyframes: [
                                  ...existing,
                                  {
                                    timeOffsetSec: offset,
                                    opacity: selectedClip.properties.opacity,
                                    scale: selectedClip.properties.scale,
                                  },
                                ],
                              },
                            });
                          }}
                          className="px-2 py-1 rounded bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30"
                        >
                          + Keyframe
                        </button>
                      </div>
                      {(selectedClip.properties.keyframes ?? []).length === 0 ? (
                        <p className="text-[11px] text-slate-500">No keyframes added yet.</p>
                      ) : (
                        <div className="space-y-1">
                          {(selectedClip.properties.keyframes ?? []).map((kf, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between px-2 py-1 rounded bg-[#141722] font-mono text-[11px]"
                            >
                              <span>@{kf.timeOffsetSec}s</span>
                              <span>
                                Scale {kf.scale} · Opacity {kf.opacity}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {inspectorTab === 'text' && (
                  <div className="space-y-3">
                    {selectedClip.kind !== 'text' ? (
                      <div className="text-center py-4 space-y-2">
                        <p className="text-slate-400">
                          Selected clip is {selectedClip.kind}. Add a text title layer to customize typography.
                        </p>
                        <button
                          onClick={addTextOverlay}
                          className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-medium"
                        >
                          Add Title Overlay
                        </button>
                      </div>
                    ) : (
                      <>
                        <div>
                          <label className="block text-slate-300 mb-1">Title Text</label>
                          <textarea
                            rows={3}
                            value={selectedClip.properties.textContent || ''}
                            onChange={(e) =>
                              updateSelectedClip({ propPatch: { textContent: e.target.value } })
                            }
                            className="w-full bg-[#151824] border border-white/10 rounded-lg p-2 text-slate-100"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-slate-300 mb-1">Position</label>
                            <select
                              value={selectedClip.properties.textPosition || 'bottom'}
                              onChange={(e) =>
                                updateSelectedClip({
                                  propPatch: {
                                    textPosition: e.target.value as 'top' | 'center' | 'bottom',
                                  },
                                })
                              }
                              className="w-full bg-[#151824] border border-white/10 rounded px-2 py-1.5"
                            >
                              <option value="top">Top</option>
                              <option value="center">Center</option>
                              <option value="bottom">Bottom</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-slate-300 mb-1">Animation</label>
                            <select
                              value={selectedClip.properties.textAnimation || 'fade_up'}
                              onChange={(e) =>
                                updateSelectedClip({
                                  propPatch: {
                                    textAnimation: e.target.value as
                                      | 'none'
                                      | 'fade_up'
                                      | 'typewriter'
                                      | 'slide_left',
                                  },
                                })
                              }
                              className="w-full bg-[#151824] border border-white/10 rounded px-2 py-1.5"
                            >
                              <option value="none">None</option>
                              <option value="fade_up">Fade Up</option>
                              <option value="typewriter">Typewriter</option>
                              <option value="slide_left">Slide Left</option>
                            </select>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Multi-Track Timeline */}
      <div className="h-64 shrink-0 border-t border-white/10 bg-[#0B0D13] flex flex-col">
        {/* Timeline Toolbar */}
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-white/8 bg-[#10131C] overflow-x-auto">
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={splitSelectedAtPlayhead}
              disabled={!selectedClip}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-slate-200 hover:bg-white/5 disabled:opacity-40 whitespace-nowrap"
            >
              <Scissors className="w-3.5 h-3.5" />
              <span>{t(language, 'splitClip')}</span>
            </button>
            <button
              onClick={mergeWithNextClip}
              disabled={!selectedClip}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-slate-200 hover:bg-white/5 disabled:opacity-40 whitespace-nowrap"
            >
              <Merge className="w-3.5 h-3.5" />
              <span>Merge</span>
            </button>
            <button
              onClick={duplicateSelectedClip}
              disabled={!selectedClip}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-slate-200 hover:bg-white/5 disabled:opacity-40 whitespace-nowrap"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Duplicate</span>
            </button>
            <button
              onClick={deleteSelectedClip}
              disabled={!selectedClip}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-rose-300 hover:bg-rose-500/10 disabled:opacity-40 whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete</span>
            </button>
            <button
              onClick={addTextOverlay}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-indigo-300 hover:bg-indigo-500/10 whitespace-nowrap"
            >
              <TypeIcon className="w-3.5 h-3.5" />
              <span>+ Text</span>
            </button>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] text-slate-400">Zoom</span>
            <input
              type="range"
              min={20}
              max={100}
              value={pxPerSec}
              onChange={(e) => setPxPerSec(Number(e.target.value))}
              className="w-24 accent-indigo-500"
            />
          </div>
        </div>

        {/* Tracks & Clips Area */}
        <div className="flex-1 flex overflow-auto relative">
          {/* Track Headers */}
          <div className="w-40 shrink-0 border-r border-white/8 bg-[#0D0F16] sticky left-0 z-20">
            <div className="h-6 border-b border-white/8 px-2 flex items-center text-[10px] font-mono text-slate-500">
              TRACKS
            </div>
            {timeline.tracks.map((tr) => (
              <div
                key={tr.id}
                className="h-10 border-b border-white/6 px-2.5 flex items-center justify-between gap-1 text-[11px] text-slate-300"
              >
                <span className="truncate font-medium">{tr.name}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() =>
                      commitTimeline({
                        ...timeline,
                        tracks: timeline.tracks.map((x) =>
                          x.id === tr.id ? { ...x, muted: !x.muted } : x
                        ),
                      })
                    }
                    className="p-0.5 text-slate-400 hover:text-white"
                    title="Mute track"
                  >
                    {tr.muted ? <VolumeX className="w-3 h-3 text-rose-400" /> : <Volume2 className="w-3 h-3" />}
                  </button>
                  <button
                    onClick={() =>
                      commitTimeline({
                        ...timeline,
                        tracks: timeline.tracks.map((x) =>
                          x.id === tr.id ? { ...x, locked: !x.locked } : x
                        ),
                      })
                    }
                    className="p-0.5 text-slate-400 hover:text-white"
                    title="Lock track"
                  >
                    {tr.locked ? <Lock className="w-3 h-3 text-amber-400" /> : <Unlock className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Scrubbable Ruler & Track Lanes */}
          <div
            className="relative flex-1 min-w-0"
            style={{ minWidth: `${totalDuration * pxPerSec}px` }}
          >
            {/* Time Ruler */}
            <div
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const sec = Math.max(0, (e.clientX - rect.left) / pxPerSec);
                setPlayheadSec(Math.round(sec * 10) / 10);
              }}
              className="h-6 border-b border-white/8 bg-[#121520] relative cursor-pointer select-none"
            >
              {Array.from({ length: totalDuration + 1 }).map((_, s) => (
                <div
                  key={s}
                  style={{ left: `${s * pxPerSec}px` }}
                  className="absolute top-0 bottom-0 border-l border-white/10 pl-1 text-[10px] font-mono text-slate-500 tabular-nums"
                >
                  {s}s
                </div>
              ))}
            </div>

            {/* Track Lanes */}
            {timeline.tracks.map((tr) => {
              const clips = timeline.clips.filter((c) => c.trackId === tr.id);
              return (
                <div
                  key={tr.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    const mId = e.dataTransfer.getData('text/media-id');
                    const asset = mediaById.get(mId);
                    if (asset) addMediaClip(asset, tr.id);
                  }}
                  className="h-10 border-b border-white/6 relative bg-[#0A0C12]"
                >
                  {clips.map((clip) => {
                    const isSel = clip.id === selectedClipId;
                    const colorClass =
                      clip.kind === 'audio'
                        ? 'bg-emerald-600/25 border-emerald-500/50 text-emerald-100'
                        : clip.kind === 'text'
                          ? 'bg-amber-600/25 border-amber-500/50 text-amber-100'
                          : 'bg-indigo-600/30 border-indigo-400/50 text-indigo-50';
                    return (
                      <div
                        key={clip.id}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setSelectedClipId(clip.id);
                          if (tr.locked) return;
                          dragStateRef.current = {
                            clipId: clip.id,
                            mode: 'move',
                            startX: e.clientX,
                            origStart: clip.startSec,
                            origDuration: clip.durationSec,
                            origIn: clip.inSec,
                          };
                        }}
                        style={{
                          left: `${clip.startSec * pxPerSec}px`,
                          width: `${Math.max(24, clip.durationSec * pxPerSec)}px`,
                        }}
                        className={`absolute top-1 bottom-1 rounded border px-2 flex items-center justify-between text-[11px] font-medium cursor-grab active:cursor-grabbing select-none ${colorClass} ${
                          isSel ? 'ring-2 ring-white/80 z-10' : ''
                        }`}
                      >
                        <span
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            if (tr.locked) return;
                            dragStateRef.current = {
                              clipId: clip.id,
                              mode: 'trim_left',
                              startX: e.clientX,
                              origStart: clip.startSec,
                              origDuration: clip.durationSec,
                              origIn: clip.inSec,
                            };
                          }}
                          className="w-1.5 h-full -ml-2 cursor-ew-resize hover:bg-white/40 rounded-l"
                        />
                        <span className="truncate flex-1 px-1">{clip.label}</span>
                        <span
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            if (tr.locked) return;
                            dragStateRef.current = {
                              clipId: clip.id,
                              mode: 'trim_right',
                              startX: e.clientX,
                              origStart: clip.startSec,
                              origDuration: clip.durationSec,
                              origIn: clip.inSec,
                            };
                          }}
                          className="w-1.5 h-full -mr-2 cursor-ew-resize hover:bg-white/40 rounded-r"
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* Playhead Indicator */}
            <div
              style={{ left: `${playheadSec * pxPerSec}px` }}
              className="absolute top-0 bottom-0 w-0.5 bg-rose-500 pointer-events-none z-30"
            >
              <div className="w-2.5 h-2.5 -ml-[4px] bg-rose-500 rotate-45 -mt-1" />
            </div>
          </div>
        </div>
      </div>

      {/* Export 4K Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-xl bg-[#12151F] border border-white/10 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-white">
                Master & Export Video
              </h3>
              <button
                onClick={() => setShowExportModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Resolution</label>
                <select
                  value={expResolution}
                  onChange={(e) => setExpResolution(e.target.value as ExportResolution)}
                  className="w-full bg-[#191D2B] border border-white/10 rounded-lg px-3 py-2 text-white"
                >
                  <option value="720p">720p HD</option>
                  <option value="1080p">1080p Full HD</option>
                  <option value="1440p">1440p 2K</option>
                  <option value="2160p">2160p 4K UHD</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Aspect Ratio</label>
                <select
                  value={expAspect}
                  onChange={(e) => setExpAspect(e.target.value as AspectRatio)}
                  className="w-full bg-[#191D2B] border border-white/10 rounded-lg px-3 py-2 text-white"
                >
                  <option value="16:9">16:9 Landscape</option>
                  <option value="9:16">9:16 Vertical</option>
                  <option value="1:1">1:1 Square</option>
                  <option value="4:5">4:5 Portrait</option>
                  <option value="21:9">21:9 Cinema</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Frame Rate</label>
                <select
                  value={expFps}
                  onChange={(e) => setExpFps(Number(e.target.value))}
                  className="w-full bg-[#191D2B] border border-white/10 rounded-lg px-3 py-2 text-white"
                >
                  <option value={24}>24 FPS (Cinema)</option>
                  <option value={30}>30 FPS (Standard)</option>
                  <option value={60}>60 FPS (Smooth)</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Format & Codec</label>
                <select
                  value={`${expFormat}:${expCodec}`}
                  onChange={(e) => {
                    const [f, c] = e.target.value.split(':');
                    setExpFormat(f as ExportFormat);
                    setExpCodec(c as ExportCodec);
                  }}
                  className="w-full bg-[#191D2B] border border-white/10 rounded-lg px-3 py-2 text-white"
                >
                  <option value="mp4:h264">MP4 (H.264)</option>
                  <option value="mp4:h265">MP4 (H.265 HEVC)</option>
                  <option value="webm:vp9">WebM (VP9)</option>
                </select>
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-[#181C29] border border-white/8 space-y-1">
              <div className="text-xs font-semibold text-indigo-300">
                {exportQualitySummary.label}
              </div>
              <p className="text-xs text-slate-400">{exportQualitySummary.detail}</p>
            </div>

            {activeExport && (
              <div className="p-3.5 rounded-lg bg-[#0D0F16] border border-white/8 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-200 capitalize">
                    Status: {activeExport.status}
                  </span>
                  <span className="font-mono tabular-nums text-indigo-300">
                    {activeExport.progress}%
                  </span>
                </div>
                <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 transition-all"
                    style={{ width: `${activeExport.progress}%` }}
                  />
                </div>
                {activeExport.status === 'completed' && activeExport.downloadUrl && (
                  <div className="flex items-center justify-between pt-1">
                    <span className="font-mono text-emerald-300 tabular-nums">
                      Verified {activeExport.verifiedWidth}×{activeExport.verifiedHeight} ·{' '}
                      {activeExport.verifiedCodec} · {activeExport.verifiedFps} FPS
                    </span>
                    <a
                      href={activeExport.downloadUrl}
                      className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                    >
                      Download
                    </a>
                  </div>
                )}
                {activeExport.status === 'failed' && (
                  <div className="text-rose-300">{activeExport.errorMessage}</div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={onNavigateQueue}
                className="text-xs text-slate-400 hover:text-white"
              >
                Open Export Queue
              </button>
              <button
                onClick={handleStartExport}
                className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
              >
                Start FFmpeg Render
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Version History Modal */}
      {showVersions && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl bg-[#12151F] border border-white/10 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-white">Version History</h3>
              <button onClick={() => setShowVersions(false)} className="text-xs text-slate-400">
                Close
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto space-y-2">
              {versions.length === 0 ? (
                <p className="text-xs text-slate-400">No saved checkpoints yet.</p>
              ) : (
                versions.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-[#181C29] border border-white/8 text-xs"
                  >
                    <div>
                      <div className="font-semibold text-white">
                        v{v.version} · {v.label}
                      </div>
                      <div className="text-slate-400 font-mono text-[11px]">
                        {new Date(v.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        const res = await api.restoreVersion(project.id, v.id);
                        onProjectChange(res.project);
                        setTimeline(res.project.timeline);
                        setShowVersions(false);
                      }}
                      className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
                    >
                      Restore
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
