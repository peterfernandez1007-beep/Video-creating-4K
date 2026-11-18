import {
  CheckCircle2,
  Copy,
  Download,
  History,
  Languages,
  Loader2,
  Mic,
  MicOff,
  Music,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
  Subtitles,
  Trash2,
  Volume2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { Language, MediaAsset, SubtitleCue } from '../types/studio';
import {
  formatBytes,
  formatMicDuration,
  pickSupportedAudioMime,
  StudioWaveformVisualizer,
  VoiceDictationButton,
} from './VoiceRecorderStudio';

interface AudioStudioViewProps {
  media: MediaAsset[];
  language: Language;
  onMediaCreated: (asset: MediaAsset) => void;
  onAddToProject: (asset: MediaAsset) => void;
  onApplySubtitles: (cues: SubtitleCue[]) => void;
}

const VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'];

type MicMode = 'exact' | 'polish' | 'reply';
type MicStep = 'idle' | 'recording' | 'paused' | 'preview' | 'transcribing' | 'synthesizing' | 'done';

interface VoiceTakeRecord {
  id: string;
  transcript: string;
  spokenText: string;
  media: MediaAsset;
  voiceName: string;
  language: Language;
  createdAt: string;
}

export function AudioStudioView({
  media,
  language,
  onMediaCreated,
  onAddToProject,
  onApplySubtitles,
}: AudioStudioViewProps) {
  const [scriptText, setScriptText] = useState(
    'Introducing Horizon GT. Engineered for silent velocity across every coastal bend.'
  );
  const [voiceName, setVoiceName] = useState('Kore');
  const [voiceStyle, setVoiceStyle] = useState('Warm, authoritative cinema trailer narrator');
  const [dualSpeaker, setDualSpeaker] = useState(false);
  const [secondSpeakerText, setSecondSpeakerText] = useState(
    'Zero emissions, instant torque, and pure aerodynamic balance.'
  );
  const [secondVoiceName, setSecondVoiceName] = useState('Puck');
  const [generatingTts, setGeneratingTts] = useState(false);
  const [generatedAudio, setGeneratedAudio] = useState<MediaAsset | null>(null);

  // Enhanced Microphone Recording & AI Speech state
  const [micMode, setMicMode] = useState<MicMode>('exact');
  const [micStep, setMicStep] = useState<MicStep>('idle');
  const [micSeconds, setMicSeconds] = useState(0);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);

  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordedDurationSec, setRecordedDurationSec] = useState(0);

  const [micTranscript, setMicTranscript] = useState('');
  const [micSpokenText, setMicSpokenText] = useState('');
  const [takeHistory, setTakeHistory] = useState<VoiceTakeRecord[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micChunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const cancelMicRef = useRef(false);
  const autoProcessOnStopRef = useRef(false);
  const micSecondsRef = useRef(0);
  const aiAudioRef = useRef<HTMLAudioElement | null>(null);

  const audioVideoMedia = media.filter((m) => m.kind === 'audio' || m.kind === 'video');
  const [sttMediaId, setSttMediaId] = useState(audioVideoMedia[0]?.id || '');
  const [sttTargetLang, setSttTargetLang] = useState<Language>(language);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [cues, setCues] = useState<SubtitleCue[]>([]);

  const [musicPrompt, setMusicPrompt] = useState(
    '30-second atmospheric electronic cinema trailer score with deep sub-bass and warm strings'
  );
  const [generatingMusic, setGeneratingMusic] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isRecording = micStep === 'recording';
  const isPaused = micStep === 'paused';
  const isProcessingMic = micStep === 'transcribing' || micStep === 'synthesizing';

  const refreshAudioDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === 'audioinput');
      setAudioDevices(inputs);
    } catch {
      // Ignore device enumeration failures
    }
  }, []);

  useEffect(() => {
    void refreshAudioDevices();
    const handler = () => void refreshAudioDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', handler);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', handler);
    };
  }, [refreshAudioDevices]);

  useEffect(() => {
    return () => {
      if (recordedUrl) {
        URL.revokeObjectURL(recordedUrl);
      }
    };
  }, [recordedUrl]);

  const cleanupMicResources = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    setAnalyserNode(null);
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      cancelMicRef.current = true;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      cleanupMicResources();
    };
  }, []);

  const clearRecordedTake = () => {
    setRecordedBlob(null);
    setRecordedUrl(null);
    setRecordedDurationSec(0);
    if (micStep === 'preview') {
      setMicStep('idle');
    }
  };

  const processRecordedBlobToAiSpeech = async (blob: Blob) => {
    setErrorMsg(null);
    setMicStep('transcribing');
    const stepTimer = window.setTimeout(() => {
      setMicStep((curr) => (curr === 'transcribing' ? 'synthesizing' : curr));
    }, 1200);

    try {
      const res = await api.micToSpeech(blob, {
        voiceName,
        style: voiceStyle,
        language: sttTargetLang,
        mode: micMode,
      });
      window.clearTimeout(stepTimer);
      setMicTranscript(res.transcript);
      setMicSpokenText(res.spokenText);
      setScriptText(res.spokenText);
      setGeneratedAudio(res.media);
      onMediaCreated(res.media);
      setTakeHistory((prev) => [
        {
          id: res.media.id,
          transcript: res.transcript,
          spokenText: res.spokenText,
          media: res.media,
          voiceName,
          language: sttTargetLang,
          createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
        ...prev.slice(0, 7),
      ]);
      setMicStep('done');

      setTimeout(() => {
        if (aiAudioRef.current) {
          aiAudioRef.current.currentTime = 0;
          void aiAudioRef.current.play().catch(() => undefined);
        }
      }, 100);
    } catch (err) {
      window.clearTimeout(stepTimer);
      setMicStep('preview');
      setErrorMsg(err instanceof Error ? err.message : 'Microphone to AI speech failed');
    }
  };

  const handleTranscribeTakeToScript = async () => {
    if (!recordedBlob) return;
    setErrorMsg(null);
    setMicStep('transcribing');
    try {
      const res = await api.micTranscribe(recordedBlob, {
        language: sttTargetLang,
        mode: micMode === 'polish' ? 'polish' : 'exact',
      });
      setMicTranscript(res.transcript);
      setMicSpokenText(res.text);
      setScriptText(res.text);
      setMicStep('preview');
    } catch (err) {
      setMicStep('preview');
      setErrorMsg(err instanceof Error ? err.message : 'Transcription failed');
    }
  };

  const handleStartMic = async () => {
    setErrorMsg(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMsg(
        sttTargetLang === 'hi'
          ? 'इस ब्राउज़र में माइक्रोफोन रिकॉर्डिंग उपलब्ध नहीं है।'
          : 'Microphone recording is not supported in this browser context.'
      );
      return;
    }

    try {
      const audioConstraints: MediaTrackConstraints | boolean = selectedDeviceId
        ? { deviceId: { exact: selectedDeviceId }, echoCancellation: true, noiseSuppression: true }
        : { echoCancellation: true, noiseSuppression: true };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      micStreamRef.current = stream;
      micChunksRef.current = [];
      cancelMicRef.current = false;
      autoProcessOnStopRef.current = false;
      clearRecordedTake();
      void refreshAudioDevices();

      try {
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.78;
        source.connect(analyser);
        setAnalyserNode(analyser);
      } catch {
        setAnalyserNode(null);
      }

      const supportedMime = pickSupportedAudioMime();
      const recorder = supportedMime
        ? new MediaRecorder(stream, { mimeType: supportedMime })
        : new MediaRecorder(stream);

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) {
          micChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        cleanupMicResources();
        if (cancelMicRef.current) {
          micChunksRef.current = [];
          setMicStep('idle');
          return;
        }
        const blob = new Blob(micChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        micChunksRef.current = [];
        if (blob.size < 400) {
          setMicStep('idle');
          setErrorMsg(
            sttTargetLang === 'hi'
              ? 'रिकॉर्डिंग बहुत छोटी थी। कृपया कम से कम 1 सेकंड बोलें।'
              : 'Recording was too short. Please speak for at least 1 second.'
          );
          return;
        }

        const nextUrl = URL.createObjectURL(blob);
        setRecordedBlob(blob);
        setRecordedUrl(nextUrl);
        setRecordedDurationSec(Math.max(1, micSecondsRef.current));

        if (autoProcessOnStopRef.current) {
          await processRecordedBlobToAiSpeech(blob);
        } else {
          setMicStep('preview');
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      micSecondsRef.current = 0;
      setMicSeconds(0);
      setMicStep('recording');
      timerRef.current = window.setInterval(() => {
        micSecondsRef.current += 1;
        setMicSeconds(micSecondsRef.current);
      }, 1000);
    } catch (err) {
      cleanupMicResources();
      setMicStep('idle');
      setErrorMsg(
        err instanceof Error && err.name === 'NotAllowedError'
          ? sttTargetLang === 'hi'
            ? 'माइक्रोफोन की अनुमति अस्वीकृत हुई। कृपया ब्राउज़र में Mic permission दें।'
            : 'Microphone permission denied. Please allow microphone access in your browser.'
          : err instanceof Error
            ? err.message
            : 'Could not access microphone.'
      );
    }
  };

  const handleTogglePauseMic = () => {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    if (rec.state === 'recording') {
      rec.pause();
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setMicStep('paused');
    } else if (rec.state === 'paused') {
      rec.resume();
      timerRef.current = window.setInterval(() => {
        micSecondsRef.current += 1;
        setMicSeconds(micSecondsRef.current);
      }, 1000);
      setMicStep('recording');
    }
  };

  const handleStopMicToPreview = () => {
    cancelMicRef.current = false;
    autoProcessOnStopRef.current = false;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleStopMicAndSpeak = () => {
    cancelMicRef.current = false;
    autoProcessOnStopRef.current = true;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleCancelMic = () => {
    cancelMicRef.current = true;
    autoProcessOnStopRef.current = false;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      cleanupMicResources();
      setMicStep('idle');
    }
  };

  const handleGenerateTts = async () => {
    setGeneratingTts(true);
    setErrorMsg(null);
    try {
      const res = await api.generateTts({
        text: scriptText,
        voiceName,
        style: voiceStyle,
        language: sttTargetLang,
        dualSpeaker,
        secondSpeakerText,
        secondVoiceName,
        title: `Voiceover (${voiceName})`,
      });
      setGeneratedAudio(res.media);
      onMediaCreated(res.media);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Voiceover generation failed');
    } finally {
      setGeneratingTts(false);
    }
  };

  const handleTranslateDub = async () => {
    setErrorMsg(null);
    try {
      const target: Language = sttTargetLang === 'hi' ? 'en' : 'hi';
      const res = await api.translateText(scriptText, target);
      setScriptText(res.translated);
      setSttTargetLang(target);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Translation failed');
    }
  };

  const handleTranscribe = async () => {
    if (!sttMediaId) return;
    setTranscribing(true);
    setErrorMsg(null);
    try {
      const res = await api.transcribeMedia(sttMediaId, sttTargetLang);
      setTranscript(res.transcript);
      setCues(res.cues);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Transcription failed');
    } finally {
      setTranscribing(false);
    }
  };

  const handleGenerateMusic = async () => {
    setGeneratingMusic(true);
    setErrorMsg(null);
    try {
      const res = await api.generateMusic(musicPrompt, 'lyria-3-clip-preview');
      onMediaCreated(res.media);
      setGeneratedAudio(res.media);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Music generation failed');
    } finally {
      setGeneratingMusic(false);
    }
  };

  const step1Done = micStep !== 'idle';
  const step2Done = micStep === 'synthesizing' || micStep === 'done' || Boolean(micTranscript);
  const step3Done = micStep === 'done';

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">
          {language === 'hi' ? 'AI ऑडियो और वॉइस रिकॉर्डिंग स्टूडियो' : 'AI Audio & Voice Recording Studio'}
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          {language === 'hi'
            ? 'लाइव वेवफॉर्म के साथ आवाज़ रिकॉर्ड करें, प्रीव्यू सुनें और AI वॉयसओवर या सबटाइटल्स बनाएं।'
            : 'Record studio voice takes with live waveform metering, audition recordings, and convert speech into AI voiceovers.'}
        </p>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-lg bg-rose-950/50 border border-rose-500/30 text-xs text-rose-200 flex items-center justify-between gap-3">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="underline shrink-0">
            {language === 'hi' ? 'बंद करें' : 'Dismiss'}
          </button>
        </div>
      )}

      {/* Pro Voice Recording Console */}
      <div className="p-5 rounded-xl bg-gradient-to-br from-[#141827] to-[#11131B] border border-indigo-500/25 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-indigo-500/15 border border-indigo-500/30">
                <Mic className="w-4 h-4 text-indigo-400" />
              </span>
              <span>
                {language === 'hi'
                  ? 'प्रो वॉइस रिकॉर्डिंग और AI स्पीच कंसोल'
                  : 'Pro Voice Recording & AI Speech Console'}
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              {language === 'hi'
                ? 'माइक से रिकॉर्ड करें, पॉज़/रीज़्यूम करें, अपनी रिकॉर्डिंग सुनें और AI आवाज़ में बदलें।'
                : 'Capture clean studio takes with Pause/Resume, preview raw audio before processing, or trigger instant AI speech.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              disabled={isRecording || isPaused || isProcessingMic}
              aria-label="Microphone Input Device"
              className="rounded-lg bg-[#090A0F] border border-white/10 px-2.5 py-1.5 text-slate-200 max-w-[190px] truncate"
            >
              <option value="">
                {language === 'hi' ? 'डिफ़ॉल्ट माइक्रोफोन' : 'Default Microphone'}
              </option>
              {audioDevices.map((d, idx) => (
                <option key={d.deviceId || idx} value={d.deviceId}>
                  {d.label || `Microphone ${idx + 1}`}
                </option>
              ))}
            </select>
            <select
              value={sttTargetLang}
              onChange={(e) => setSttTargetLang(e.target.value as Language)}
              aria-label="Speech Output Language"
              className="rounded-lg bg-[#090A0F] border border-white/10 px-2.5 py-1.5 text-slate-100"
            >
              <option value="hi">हिन्दी (Hindi)</option>
              <option value="en">English</option>
            </select>
            <select
              value={voiceName}
              onChange={(e) => setVoiceName(e.target.value)}
              aria-label="AI Voice"
              className="rounded-lg bg-[#090A0F] border border-white/10 px-2.5 py-1.5 text-slate-100"
            >
              {VOICES.map((v) => (
                <option key={v} value={v}>
                  Voice: {v}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Mode Selector */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          {(
            [
              {
                id: 'exact',
                en: 'Repeat My Exact Words',
                enDesc: 'Transcribe and speak word-for-word',
                hi: 'जैसा बोला वैसा बुलवाएं',
                hiDesc: 'बिल्कुल वही शब्द AI आवाज़ में',
              },
              {
                id: 'polish',
                en: 'Polish Script & Speak',
                enDesc: 'Clean fillers into studio copy',
                hi: 'सुधारकर साफ़ बुलवाएं',
                hiDesc: 'स्क्रिप्ट को निखारकर बुलवाएं',
              },
              {
                id: 'reply',
                en: 'AI Responds to Me',
                enDesc: 'Conversational spoken reply',
                hi: 'AI मेरी बात का जवाब बोले',
                hiDesc: 'आपकी बात पर स्मार्ट AI जवाब',
              },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMicMode(m.id)}
              disabled={isRecording || isPaused || isProcessingMic}
              className={`p-2.5 rounded-lg border text-left transition-colors ${
                micMode === m.id
                  ? 'bg-indigo-600/20 border-indigo-400/70 text-white'
                  : 'bg-[#090A0F] border-white/8 text-slate-400 hover:text-slate-200 hover:border-white/15'
              }`}
            >
              <div className="font-medium">{language === 'hi' ? m.hi : m.en}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {language === 'hi' ? m.hiDesc : m.enDesc}
              </div>
            </button>
          ))}
        </div>

        {/* Live Waveform Deck + Status Header */}
        <div className="p-4 rounded-xl bg-[#090A0F] border border-white/10 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2.5">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono text-[11px] font-semibold border ${
                  isRecording
                    ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                    : isPaused
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                      : isProcessingMic
                        ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300'
                        : recordedBlob
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                          : 'bg-white/5 border-white/10 text-slate-400'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isRecording
                      ? 'bg-rose-500 animate-pulse'
                      : isPaused
                        ? 'bg-amber-400'
                        : isProcessingMic
                          ? 'bg-indigo-400 animate-ping'
                          : recordedBlob
                            ? 'bg-emerald-400'
                            : 'bg-slate-500'
                  }`}
                />
                <span>
                  {isRecording
                    ? language === 'hi'
                      ? 'रिकॉर्डिंग चालू'
                      : 'REC LIVE'
                    : isPaused
                      ? language === 'hi'
                        ? 'पॉज़्ड'
                        : 'PAUSED'
                      : micStep === 'transcribing'
                        ? language === 'hi'
                          ? 'लिखा जा रहा है...'
                          : 'TRANSCRIBING'
                        : micStep === 'synthesizing'
                          ? language === 'hi'
                            ? 'AI आवाज़ बन रही है...'
                            : 'SYNTHESIZING VOICE'
                          : recordedBlob
                            ? language === 'hi'
                              ? 'टेक तैयार'
                              : 'TAKE READY'
                            : language === 'hi'
                              ? 'तैयार'
                              : 'READY'}
                </span>
              </span>

              <span className="font-mono text-base font-semibold text-white tabular-nums">
                {formatMicDuration(isRecording || isPaused ? micSeconds : recordedDurationSec)}
              </span>

              {recordedBlob && !isRecording && !isPaused && (
                <span className="text-[11px] font-mono text-slate-400">
                  {formatBytes(recordedBlob.size)}
                </span>
              )}
            </div>

            {/* 3-Step Pipeline Indicator */}
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <span className={`flex items-center gap-1 ${step1Done ? 'text-indigo-300' : ''}`}>
                <CheckCircle2 className="w-3 h-3" />
                <span>{language === 'hi' ? '1. रिकॉर्ड' : '1. Capture'}</span>
              </span>
              <span className="text-slate-600">→</span>
              <span className={`flex items-center gap-1 ${step2Done ? 'text-indigo-300' : ''}`}>
                {micStep === 'transcribing' ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3 h-3" />
                )}
                <span>{language === 'hi' ? '2. टेक्स्ट' : '2. Transcribe'}</span>
              </span>
              <span className="text-slate-600">→</span>
              <span className={`flex items-center gap-1 ${step3Done ? 'text-emerald-300' : ''}`}>
                {micStep === 'synthesizing' ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3 h-3" />
                )}
                <span>{language === 'hi' ? '3. AI आवाज़' : '3. AI Voice'}</span>
              </span>
            </div>
          </div>

          <StudioWaveformVisualizer
            analyser={analyserNode}
            isRecording={isRecording}
            isPaused={isPaused}
            hasTake={Boolean(recordedBlob)}
            heightClass="h-24"
          />

          {/* Transport Controls */}
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            {!isRecording && !isPaused ? (
              <button
                type="button"
                onClick={handleStartMic}
                disabled={isProcessingMic}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50"
              >
                {isProcessingMic ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
                <span>
                  {recordedBlob
                    ? language === 'hi'
                      ? 'दोबारा रिकॉर्ड करें'
                      : 'Record New Take'
                    : language === 'hi'
                      ? 'रिकॉर्डिंग शुरू करें'
                      : 'Start Recording'}
                </span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleTogglePauseMic}
                  className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-xs font-semibold"
                >
                  {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                  <span>
                    {isPaused
                      ? language === 'hi'
                        ? 'जारी रखें'
                        : 'Resume'
                      : language === 'hi'
                        ? 'रोकें (Pause)'
                        : 'Pause'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleStopMicToPreview}
                  className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-white text-xs font-semibold"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>{language === 'hi' ? 'रोकें और सुनें' : 'Stop & Preview'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleStopMicAndSpeak}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>
                    {language === 'hi'
                      ? 'रोकें और AI से बुलवाएं'
                      : 'Stop & AI Speak Now'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleCancelMic}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-transparent hover:bg-white/8 text-slate-400 hover:text-rose-300 text-xs"
                >
                  <MicOff className="w-3.5 h-3.5" />
                  <span>{language === 'hi' ? 'रद्द करें' : 'Cancel'}</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Recorded Raw Take Audition Card */}
        {recordedUrl && recordedBlob && !isRecording && !isPaused && (
          <div className="p-4 rounded-xl bg-[#0B0D14] border border-emerald-500/25 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-emerald-300 font-semibold">
                  {language === 'hi' ? 'आपकी रिकॉर्डिंग (Preview)' : 'Your Recorded Voice Take'}
                </span>
                <span className="font-mono text-[11px] text-slate-400">
                  {formatMicDuration(recordedDurationSec)} · {formatBytes(recordedBlob.size)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={recordedUrl}
                  download={`voice_take_${Date.now()}.webm`}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-white/8 hover:bg-white/12 text-slate-200"
                >
                  <Download className="w-3 h-3" />
                  <span>{language === 'hi' ? 'सेव करें' : 'Download Take'}</span>
                </a>
                <button
                  type="button"
                  onClick={clearRecordedTake}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-white/5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-200"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>{language === 'hi' ? 'हटाएं' : 'Discard'}</span>
                </button>
              </div>
            </div>

            <audio src={recordedUrl} controls className="w-full h-9" />

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                type="button"
                disabled={isProcessingMic}
                onClick={() => void processRecordedBlobToAiSpeech(recordedBlob)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50"
              >
                {micStep === 'synthesizing' || micStep === 'transcribing' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
                <span>
                  {language === 'hi'
                    ? `AI आवाज़ (${voiceName}) में बुलवाएं`
                    : `Convert to AI Voice (${voiceName})`}
                </span>
              </button>
              <button
                type="button"
                disabled={isProcessingMic}
                onClick={handleTranscribeTakeToScript}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/8 hover:bg-white/14 border border-white/10 text-slate-200 text-xs font-medium disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>
                  {language === 'hi'
                    ? 'केवल स्क्रिप्ट बॉक्स में लिखें'
                    : 'Transcribe to Script Only'}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Transcript + AI Output Script + Final AI Audio */}
        {(micTranscript || micSpokenText) && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-[#090A0F] border border-white/8 space-y-1.5">
                <div className="flex items-center justify-between text-slate-400 font-medium">
                  <span>{language === 'hi' ? 'आपने बोला (Transcript)' : 'You Spoke (Transcript)'}</span>
                  <button
                    type="button"
                    onClick={() => setScriptText(micTranscript)}
                    className="flex items-center gap-1 text-[11px] text-indigo-300 hover:text-indigo-200"
                  >
                    <Copy className="w-3 h-3" />
                    <span>{language === 'hi' ? 'स्क्रिप्ट में भेजें' : 'Use in Script'}</span>
                  </button>
                </div>
                <div className="text-slate-200">{micTranscript}</div>
              </div>
              <div className="p-3 rounded-lg bg-[#090A0F] border border-indigo-500/20 space-y-1.5">
                <div className="text-indigo-300 font-medium flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>
                    {language === 'hi' ? 'AI ने बोला (AI Voice Script)' : 'AI Voice Output Script'}
                  </span>
                </div>
                <div className="text-slate-100">{micSpokenText}</div>
              </div>
            </div>

            {generatedAudio && (
              <div className="p-3.5 rounded-lg bg-[#090A0F] border border-emerald-500/30 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-emerald-300 font-medium">{generatedAudio.title}</span>
                  <div className="flex items-center gap-2">
                    <a
                      href={generatedAudio.url}
                      download={`${generatedAudio.title.replace(/[^a-z0-9_-]/gi, '_')}.wav`}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-white/10 hover:bg-white/15 text-slate-200"
                    >
                      <Download className="w-3 h-3" />
                      <span>WAV</span>
                    </a>
                    <button
                      type="button"
                      onClick={() => onAddToProject(generatedAudio)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white"
                    >
                      <Plus className="w-3 h-3" />
                      <span>{language === 'hi' ? 'ऑडियो ट्रैक में जोड़ें' : 'Add to Audio Track'}</span>
                    </button>
                  </div>
                </div>
                <audio ref={aiAudioRef} src={generatedAudio.url} controls className="w-full h-9" />
              </div>
            )}
          </div>
        )}

        {/* Session Voice Takes History */}
        {takeHistory.length > 0 && (
          <div className="pt-2 border-t border-white/8 space-y-2">
            <div className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-indigo-400" />
              <span>
                {language === 'hi'
                  ? `हाल के वॉइस टेक्स (${takeHistory.length})`
                  : `Session Voice Takes (${takeHistory.length})`}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {takeHistory.map((item) => (
                <div
                  key={item.id}
                  className="p-2.5 rounded-lg bg-[#090A0F] border border-white/8 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="text-slate-200 truncate">{item.spokenText}</div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      {item.voiceName} · {item.language.toUpperCase()} · {item.createdAt}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setGeneratedAudio(item.media);
                        setMicTranscript(item.transcript);
                        setMicSpokenText(item.spokenText);
                      }}
                      className="px-2 py-1 rounded bg-white/8 hover:bg-white/15 text-slate-200 text-[11px]"
                    >
                      {language === 'hi' ? 'सुनें' : 'Load'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onAddToProject(item.media)}
                      className="p-1.5 rounded bg-indigo-600/25 hover:bg-indigo-600 text-indigo-200 hover:text-white"
                      title={language === 'hi' ? 'टाइमलाइन में जोड़ें' : 'Add to Audio Track'}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* TTS & AI Dubbing */}
        <div className="p-5 rounded-xl bg-[#11131B] border border-white/8 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Mic className="w-4 h-4 text-indigo-400" />
              <span>AI Voiceover & Dubbing (Gemini 3.8 TTS)</span>
            </h2>
            <div className="flex items-center gap-2">
              <VoiceDictationButton
                language={sttTargetLang}
                onTranscript={(spoken) =>
                  setScriptText((prev) => (prev.trim() ? `${prev.trim()} ${spoken}` : spoken))
                }
                onError={(msg) => setErrorMsg(msg)}
              />
              <button
                type="button"
                onClick={handleTranslateDub}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-slate-200"
              >
                <Languages className="w-3.5 h-3.5" />
                <span>Translate EN ↔ हिन्दी</span>
              </button>
            </div>
          </div>

          <textarea
            rows={3}
            value={scriptText}
            onChange={(e) => setScriptText(e.target.value)}
            className="w-full rounded-lg bg-[#090A0F] border border-white/10 p-3 text-sm text-slate-100"
          />

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Primary Voice</label>
              <select
                value={voiceName}
                onChange={(e) => setVoiceName(e.target.value)}
                className="w-full rounded-lg bg-[#090A0F] border border-white/10 px-3 py-2 text-slate-100"
              >
                {VOICES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Delivery Style</label>
              <input
                value={voiceStyle}
                onChange={(e) => setVoiceStyle(e.target.value)}
                className="w-full rounded-lg bg-[#090A0F] border border-white/10 px-3 py-2 text-slate-100"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={dualSpeaker}
              onChange={(e) => setDualSpeaker(e.target.checked)}
              className="accent-indigo-500"
            />
            <span>Enable Dual-Speaker Screenplay / Podcast Mode (Gemini 3.8 Flash TTS)</span>
          </label>

          {dualSpeaker && (
            <div className="space-y-2 p-3 rounded-lg bg-[#090A0F] border border-white/8">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Speaker 2 Line</span>
                <select
                  value={secondVoiceName}
                  onChange={(e) => setSecondVoiceName(e.target.value)}
                  className="bg-[#151824] border border-white/10 rounded px-2 py-1 text-xs"
                >
                  {VOICES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                rows={2}
                value={secondSpeakerText}
                onChange={(e) => setSecondSpeakerText(e.target.value)}
                className="w-full rounded bg-[#151824] border border-white/10 p-2 text-xs text-slate-100"
              />
            </div>
          )}

          <button
            type="button"
            onClick={handleGenerateTts}
            disabled={generatingTts}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50"
          >
            {generatingTts ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
            <span>Generate Studio Voiceover (WAV)</span>
          </button>

          {generatedAudio && (
            <div className="p-3 rounded-lg bg-[#090A0F] border border-emerald-500/30 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-emerald-300 font-medium">{generatedAudio.title}</span>
                <button
                  type="button"
                  onClick={() => onAddToProject(generatedAudio)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-600 text-white"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add to Audio Track</span>
                </button>
              </div>
              <audio src={generatedAudio.url} controls className="w-full h-9" />
            </div>
          )}
        </div>

        {/* Speech-to-Text, Subtitle Sync & Background Music */}
        <div className="space-y-6">
          <div className="p-5 rounded-xl bg-[#11131B] border border-white/8 space-y-4">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Subtitles className="w-4 h-4 text-indigo-400" />
              <span>Speech-to-Text & Subtitle Sync</span>
            </h2>

            <div className="grid grid-cols-3 gap-2 text-xs">
              <select
                value={sttMediaId}
                onChange={(e) => setSttMediaId(e.target.value)}
                className="col-span-2 rounded-lg bg-[#090A0F] border border-white/10 px-3 py-2 text-slate-100"
              >
                {media
                  .filter((m) => m.kind === 'audio' || m.kind === 'video')
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title} ({m.kind})
                    </option>
                  ))}
              </select>
              <select
                value={sttTargetLang}
                onChange={(e) => setSttTargetLang(e.target.value as Language)}
                className="rounded-lg bg-[#090A0F] border border-white/10 px-3 py-2 text-slate-100"
              >
                <option value="en">English</option>
                <option value="hi">हिन्दी</option>
              </select>
            </div>

            <button
              type="button"
              onClick={handleTranscribe}
              disabled={transcribing || !sttMediaId}
              className="w-full py-2 rounded-lg bg-[#1A1E2B] hover:bg-[#23293A] border border-white/10 text-xs font-semibold text-white flex items-center justify-center gap-2"
            >
              {transcribing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Transcribe & Generate Timed Subtitles</span>
            </button>

            {transcript && (
              <div className="space-y-2 text-xs">
                <div className="p-2.5 rounded bg-[#090A0F] border border-white/8 text-slate-300 max-h-24 overflow-y-auto">
                  {transcript}
                </div>
                {cues.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">{cues.length} subtitle cues ready</span>
                      <button
                        type="button"
                        onClick={() => onApplySubtitles(cues)}
                        className="px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
                      >
                        Sync to Timeline Subtitles
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="p-5 rounded-xl bg-[#11131B] border border-white/8 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Music className="w-4 h-4 text-indigo-400" />
                <span>AI Background Music (Lyria 3 Clip)</span>
              </h2>
              <VoiceDictationButton
                language={language}
                onTranscript={(spoken) =>
                  setMusicPrompt((prev) => (prev.trim() ? `${prev.trim()} ${spoken}` : spoken))
                }
                onError={(msg) => setErrorMsg(msg)}
              />
            </div>
            <input
              value={musicPrompt}
              onChange={(e) => setMusicPrompt(e.target.value)}
              className="w-full rounded-lg bg-[#090A0F] border border-white/10 px-3 py-2 text-xs text-slate-100"
            />
            <button
              type="button"
              onClick={handleGenerateMusic}
              disabled={generatingMusic}
              className="w-full py-2 rounded-lg bg-[#1A1E2B] hover:bg-[#23293A] border border-white/10 text-xs font-semibold text-white flex items-center justify-center gap-2"
            >
              {generatingMusic && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Compose 30s Music Track (Paid Tier)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
