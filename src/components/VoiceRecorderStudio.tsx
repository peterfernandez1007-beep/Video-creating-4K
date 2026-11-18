import { Check, Loader2, Mic, Pause, Play, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { Language } from '../types/studio';

export function pickSupportedAudioMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const preferred = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  return preferred.find((t) => MediaRecorder.isTypeSupported(t));
}

export function formatMicDuration(sec: number): string {
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

interface StudioWaveformVisualizerProps {
  analyser: AnalyserNode | null;
  isRecording: boolean;
  isPaused: boolean;
  hasTake: boolean;
  heightClass?: string;
}

export function StudioWaveformVisualizer({
  analyser,
  isRecording,
  isPaused,
  hasTake,
  heightClass = 'h-20',
}: StudioWaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const peakHoldRef = useRef<number[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = parent.getBoundingClientRect();
      canvas.width = Math.max(240, Math.floor(rect.width * dpr));
      canvas.height = Math.max(48, Math.floor(rect.height * dpr));
    };

    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const ctx = canvas.getContext('2d');
    const freqData = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    let phase = 0;

    const draw = () => {
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      const midY = h / 2;

      ctx.clearRect(0, 0, w, h);

      // Center guide line
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(w, midY);
      ctx.stroke();

      const barCount = Math.max(36, Math.min(72, Math.floor(w / 10)));
      if (peakHoldRef.current.length !== barCount) {
        peakHoldRef.current = new Array(barCount).fill(0);
      }

      if (analyser && freqData && isRecording && !isPaused) {
        analyser.getByteFrequencyData(freqData);
      }

      const gap = 3;
      const barWidth = Math.max(2, (w - gap * (barCount - 1)) / barCount);

      for (let i = 0; i < barCount; i++) {
        let norm = 0.06;
        if (isRecording && !isPaused && freqData) {
          const binIdx = Math.min(
            freqData.length - 1,
            Math.floor((i / barCount) * (freqData.length * 0.75))
          );
          const raw = freqData[binIdx] / 255;
          // Mirror slight energy curve across bars for balanced studio look
          norm = Math.max(0.08, Math.min(1, raw * 1.18));
        } else if (isPaused) {
          norm = 0.12 + 0.05 * Math.sin(i * 0.5);
        } else if (hasTake) {
          norm = 0.14 + 0.14 * Math.abs(Math.sin(i * 0.45 + 1.2));
        } else {
          phase += 0.0005;
          norm = 0.06 + 0.03 * Math.sin(i * 0.35 + phase);
        }

        // Smooth peak falloff
        const prev = peakHoldRef.current[i] || 0;
        const smoothed = norm > prev ? norm * 0.85 + prev * 0.15 : prev * 0.88 + norm * 0.12;
        peakHoldRef.current[i] = smoothed;

        const barH = Math.max(4, smoothed * (h * 0.84));
        const x = i * (barWidth + gap);
        const y = midY - barH / 2;

        if (isRecording && !isPaused) {
          const grad = ctx.createLinearGradient(0, y, 0, y + barH);
          if (smoothed > 0.72) {
            grad.addColorStop(0, '#fb7185');
            grad.addColorStop(0.5, '#a855f7');
            grad.addColorStop(1, '#fb7185');
          } else {
            grad.addColorStop(0, '#818cf8');
            grad.addColorStop(0.5, '#6366f1');
            grad.addColorStop(1, '#818cf8');
          }
          ctx.fillStyle = grad;
        } else if (isPaused) {
          ctx.fillStyle = 'rgba(251, 191, 36, 0.55)';
        } else if (hasTake) {
          ctx.fillStyle = 'rgba(52, 211, 153, 0.55)';
        } else {
          ctx.fillStyle = 'rgba(99, 102, 241, 0.25)';
        }

        const radius = Math.min(barWidth / 2, 3);
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barH, radius);
        ctx.fill();
      }

      if (isRecording && !isPaused) {
        rafRef.current = requestAnimationFrame(draw);
      }
    };

    draw();

    return () => {
      ro.disconnect();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [analyser, isRecording, isPaused, hasTake]);

  return (
    <div className={`relative w-full ${heightClass} rounded-lg bg-[#07080D] border border-white/8 overflow-hidden px-2`}>
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}

interface VoiceDictationButtonProps {
  language?: Language;
  polish?: boolean;
  onTranscript: (text: string) => void;
  onError?: (message: string) => void;
  label?: string;
}

export function VoiceDictationButton({
  language = 'en',
  polish = false,
  onTranscript,
  onError,
  label,
}: VoiceDictationButtonProps) {
  const [state, setState] = useState<'idle' | 'recording' | 'paused' | 'transcribing'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const miniCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const stopMeterLoop = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const cleanup = () => {
    stopMeterLoop();
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      cleanup();
    };
  }, []);

  const drawMiniMeter = () => {
    const canvas = miniCanvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const render = () => {
      analyser.getByteFrequencyData(data);
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const bars = 10;
      const gap = 2;
      const bw = Math.floor((w - gap * (bars - 1)) / bars);

      for (let i = 0; i < bars; i++) {
        const val = data[Math.min(data.length - 1, i * 2)] / 255;
        const bh = Math.max(3, Math.round(val * h));
        const x = i * (bw + gap);
        const y = (h - bh) / 2;
        ctx.fillStyle = val > 0.65 ? '#fb7185' : '#818cf8';
        ctx.fillRect(x, y, bw, bh);
      }
      rafRef.current = requestAnimationFrame(render);
    };
    render();
  };

  const reportError = (msg: string) => {
    setLocalError(msg);
    onError?.(msg);
  };

  const handleStart = async () => {
    setLocalError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      reportError(
        language === 'hi'
          ? 'इस ब्राउज़र में माइक्रोफोन समर्थित नहीं है।'
          : 'Microphone recording is not supported in this browser.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      cancelledRef.current = false;

      try {
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        src.connect(analyser);
        analyserRef.current = analyser;
      } catch {
        // Optional meter
      }

      const mime = pickSupportedAudioMime();
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        cleanup();
        if (cancelledRef.current) {
          chunksRef.current = [];
          setState('idle');
          return;
        }
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        chunksRef.current = [];
        if (blob.size < 400) {
          setState('idle');
          reportError(
            language === 'hi'
              ? 'आवाज़ बहुत छोटी थी। कृपया कम से कम 1 सेकंड बोलें।'
              : 'Voice clip was too short. Please speak for at least 1 second.'
          );
          return;
        }

        setState('transcribing');
        try {
          const res = await api.micTranscribe(blob, {
            language,
            mode: polish ? 'polish' : 'exact',
          });
          onTranscript(res.text || res.transcript);
        } catch (err) {
          reportError(err instanceof Error ? err.message : 'Voice transcription failed');
        } finally {
          setState('idle');
        }
      };

      recorderRef.current = recorder;
      recorder.start(250);
      setSeconds(0);
      setState('recording');
      timerRef.current = window.setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);
      setTimeout(() => {
        drawMiniMeter();
      }, 30);
    } catch (err) {
      cleanup();
      setState('idle');
      reportError(
        err instanceof Error && err.name === 'NotAllowedError'
          ? language === 'hi'
            ? 'माइक अनुमति अस्वीकृत हुई। कृपया ब्राउज़र में Mic Allow करें।'
            : 'Microphone permission denied. Please allow mic access.'
          : err instanceof Error
            ? err.message
            : 'Could not start microphone.'
      );
    }
  };

  const handleTogglePause = () => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (rec.state === 'recording') {
      rec.pause();
      stopMeterLoop();
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setState('paused');
    } else if (rec.state === 'paused') {
      rec.resume();
      timerRef.current = window.setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);
      drawMiniMeter();
      setState('recording');
    }
  };

  const handleFinish = () => {
    cancelledRef.current = false;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  };

  const handleCancel = () => {
    cancelledRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    } else {
      cleanup();
      setState('idle');
    }
  };

  if (state === 'idle') {
    return (
      <div className="inline-flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={handleStart}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-200 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          title={language === 'hi' ? 'माइक से बोलकर लिखें' : 'Dictate prompt using microphone'}
        >
          <Mic className="w-3.5 h-3.5 text-rose-400" />
          <span>{label || (language === 'hi' ? 'बोलकर लिखें' : 'Voice Input')}</span>
        </button>
        {localError && !onError && (
          <span className="text-[11px] text-rose-300 max-w-[220px] text-right">{localError}</span>
        )}
      </div>
    );
  }

  if (state === 'transcribing') {
    return (
      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/15 border border-indigo-400/30 text-indigo-200 text-xs font-medium whitespace-nowrap shrink-0">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
        <span>{language === 'hi' ? 'आवाज़ लिखी जा रही है...' : 'Transcribing voice...'}</span>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-[#090A0F] border border-rose-500/40 shadow-sm shadow-rose-950/30">
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${
          state === 'recording' ? 'bg-rose-500 animate-pulse' : 'bg-amber-400'
        }`}
      />
      <span className="font-mono text-[11px] text-slate-200 tabular-nums">
        {formatMicDuration(seconds)}
      </span>
      <canvas ref={miniCanvasRef} width={44} height={18} className="block rounded-sm" />
      <button
        type="button"
        onClick={handleTogglePause}
        className="p-1 rounded hover:bg-white/10 text-slate-300 hover:text-white"
        title={state === 'paused' ? 'Resume' : 'Pause'}
      >
        {state === 'paused' ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
      </button>
      <button
        type="button"
        onClick={handleFinish}
        className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold"
        title={language === 'hi' ? 'बोलना पूरा करें' : 'Insert spoken text'}
      >
        <Check className="w-3 h-3" />
        <span>{language === 'hi' ? 'हो गया' : 'Done'}</span>
      </button>
      <button
        type="button"
        onClick={handleCancel}
        className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-rose-300"
        title={language === 'hi' ? 'रद्द करें' : 'Cancel'}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
