import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import fs from 'node:fs';
import type { EnhancedPromptBreakdown, Language, SubtitleCue } from '../src/types/studio.js';

export function getGeminiClient(apiVersion?: 'v1' | 'v1beta'): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured in environment secrets. Set GEMINI_API_KEY in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function getGeminiBetaClient(): GoogleGenAI {
  return getGeminiClient('v1beta');
}

export function formatGeminiError(err: unknown, context = 'GeminiAPI'): string {
  const rawMsg = err instanceof Error ? err.message : String(err);
  let parsedCode: number | undefined =
    typeof (err as { status?: unknown })?.status === 'number'
      ? (err as { status: number }).status
      : undefined;
  let parsedStatus: string | undefined;
  let parsedMessage = rawMsg;

  try {
    const jsonStart = rawMsg.indexOf('{');
    if (jsonStart >= 0) {
      const parsed = JSON.parse(rawMsg.slice(jsonStart)) as {
        error?: { code?: number; message?: string; status?: string };
      };
      if (parsed.error) {
        parsedCode = parsed.error.code ?? parsedCode;
        parsedStatus = parsed.error.status;
        parsedMessage = parsed.error.message || rawMsg;
      }
    }
  } catch {
    // Keep rawMsg if not JSON
  }

  console.error(`[${context}]`, {
    code: parsedCode,
    status: parsedStatus,
    message: parsedMessage.slice(0, 400),
  });

  if (
    parsedCode === 403 ||
    parsedStatus === 'PERMISSION_DENIED' ||
    parsedMessage.includes('API_KEY_INVALID')
  ) {
    return 'Gemini API authentication failed (403/400). Verify GEMINI_API_KEY in Settings > Secrets.';
  }
  if (
    parsedCode === 429 ||
    parsedStatus === 'RESOURCE_EXHAUSTED' ||
    parsedMessage.toLowerCase().includes('billing') ||
    parsedMessage.toLowerCase().includes('quota')
  ) {
    return 'This Gemini model requires a billing-enabled API key or exceeded quota (429). Update your key in Settings > Secrets or use the Local FFmpeg Studio Engine.';
  }
  if (
    parsedCode === 503 ||
    parsedStatus === 'UNAVAILABLE' ||
    parsedMessage.toLowerCase().includes('high demand') ||
    parsedMessage.toLowerCase().includes('temporarily unavailable')
  ) {
    return `Gemini model is temporarily busy due to high demand (503). Please retry in a few seconds. (${parsedMessage})`;
  }
  if (parsedCode === 404 || parsedStatus === 'NOT_FOUND') {
    return `Requested Gemini model or endpoint was not found (404): ${parsedMessage}`;
  }
  if (parsedCode === 400 || parsedStatus === 'INVALID_ARGUMENT') {
    return `Invalid Gemini API request parameters (400): ${parsedMessage}`;
  }
  if (
    parsedMessage.includes('fetch failed') ||
    parsedMessage.includes('ECONNREFUSED') ||
    parsedMessage.includes('ETIMEDOUT') ||
    parsedMessage.includes('ECONNRESET') ||
    parsedMessage.includes('network')
  ) {
    return 'Network connection to Gemini API failed or timed out (502). Check connectivity and retry.';
  }
  return parsedMessage;
}

export function getGeminiHttpStatus(formattedError: string): number {
  if (formattedError.includes('(400)')) return 400;
  if (formattedError.includes('(403')) return 403;
  if (formattedError.includes('(404)')) return 404;
  if (formattedError.includes('(429)')) return 429;
  if (formattedError.includes('(503)')) return 503;
  if (formattedError.includes('(502)')) return 502;
  return 500;
}

async function withTransientRetry<T>(fn: () => Promise<T>, _label?: string): Promise<T> {
  const delays = [900, 2000];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const status = (err as { status?: number })?.status;
      const isTransient =
        status === 503 ||
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.toLowerCase().includes('high demand') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('ECONNRESET');
      if (!isTransient || attempt === delays.length) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
  throw lastErr;
}

export async function generateEnhancedVideoPrompt(
  idea: string,
  style: string,
  language: Language
): Promise<EnhancedPromptBreakdown> {
  const ai = getGeminiClient();
  const langNote =
    language === 'hi'
      ? 'Write descriptive fields in clear Hindi (Devanagari) and keep compiledPrompt in crisp cinematic English suitable for AI video models.'
      : 'Write all fields in crisp, production-ready English.';

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Transform this video concept into a structured cinematic production prompt.\nConcept: "${idea}"\nTarget Visual Style: "${style}"\n${langNote}`,
    config: {
      systemInstruction:
        'You are a senior film director and AI video prompt architect. Produce concrete, physically grounded camera, lighting, motion, and audio directions.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          sceneDescription: { type: Type.STRING },
          subject: { type: Type.STRING },
          cameraAngle: { type: Type.STRING },
          cameraMovement: { type: Type.STRING },
          lighting: { type: Type.STRING },
          environment: { type: Type.STRING },
          visualStyle: { type: Type.STRING },
          motionDescription: { type: Type.STRING },
          audioInstructions: { type: Type.STRING },
          sceneContinuity: { type: Type.STRING },
          compiledPrompt: { type: Type.STRING },
        },
        required: [
          'sceneDescription',
          'subject',
          'cameraAngle',
          'cameraMovement',
          'lighting',
          'environment',
          'visualStyle',
          'motionDescription',
          'audioInstructions',
          'sceneContinuity',
          'compiledPrompt',
        ],
      },
    },
  });

  const text = (response.text ?? '').trim();
  if (!text) {
    throw new Error('Empty response from Gemini prompt assistant');
  }
  return JSON.parse(text) as EnhancedPromptBreakdown;
}

function wrapPcmAsWav(pcmBuffer: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBuffer.length, 40);
  return Buffer.concat([header, pcmBuffer]);
}

function normalizeAudioResponse(rawBuffer: Buffer, mimeType: string): { buffer: Buffer; mimeType: string } {
  const isRiffWav =
    rawBuffer.length >= 12 &&
    rawBuffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    rawBuffer.subarray(8, 12).toString('ascii') === 'WAVE';

  if (isRiffWav) {
    return { buffer: rawBuffer, mimeType: 'audio/wav' };
  }

  const lower = mimeType.toLowerCase();
  if (lower.includes('l16') || lower.includes('pcm')) {
    const rateMatch = /rate=(\d+)/i.exec(mimeType);
    const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
    return {
      buffer: wrapPcmAsWav(rawBuffer, sampleRate, 1, 16),
      mimeType: 'audio/wav',
    };
  }

  return { buffer: rawBuffer, mimeType: mimeType || 'audio/wav' };
}

export async function generateVoiceoverTts(params: {
  text: string;
  voiceName: string;
  style?: string;
  language?: Language;
  dualSpeaker?: boolean;
  secondSpeakerText?: string;
  secondVoiceName?: string;
}): Promise<{ buffer: Buffer; mimeType: string }> {
  const ai = getGeminiBetaClient();
  const isDual = Boolean(params.dualSpeaker && params.secondSpeakerText?.trim());
  const model = isDual ? 'gemini-3.8-flash-tts' : 'gemini-3.8-flash-lite-tts';
  const langLabel = params.language === 'hi' ? 'Hindi (hi-IN)' : 'English (en-US)';
  const styleNote = params.style?.trim() || 'Clear, studio broadcast voiceover';

  const promptText = isDual
    ? [
        `Language: ${langLabel}.`,
        `Delivery style: ${styleNote}.`,
        `Read this two-speaker script aloud naturally with distinct speaker voices (${params.voiceName || 'Puck'} for Speaker 1, ${params.secondVoiceName || 'Kore'} for Speaker 2).`,
        `Speaker 1 (${params.voiceName || 'Puck'}): ${params.text}`,
        `Speaker 2 (${params.secondVoiceName || 'Kore'}): ${params.secondSpeakerText}`,
      ].join('\n')
    : [
        `Language: ${langLabel}.`,
        `Voice persona: ${params.voiceName || 'Kore'}.`,
        `Delivery style: ${styleNote}.`,
        `Read the following script aloud exactly as written:`,
        params.text,
      ].join('\n');

  const response = await withTransientRetry(
    () =>
      ai.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [{ text: promptText }],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
        },
      }),
    'AudioTTS'
  );

  const audioPart = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!audioPart?.inlineData?.data) {
    throw new Error(`No audio data returned by ${model}`);
  }

  const rawBuffer = Buffer.from(audioPart.inlineData.data, 'base64');
  const mimeType = audioPart.inlineData.mimeType || 'audio/wav';
  return normalizeAudioResponse(rawBuffer, mimeType);
}

export async function transcribeSpeechOnly(audioPath: string, mimeType: string): Promise<string> {
  const betaAi = getGeminiBetaClient();
  const base64Audio = fs.readFileSync(audioPath).toString('base64');
  const promptText =
    'Transcribe this spoken audio accurately in its original language (Hindi Devanagari or English). Return only the spoken words without extra commentary.';

  try {
    const transcribeInteraction = await withTransientRetry(() =>
      betaAi.interactions.create({
        model: 'gemini-3.5-transcribe',
        input: [
          {
            type: 'audio',
            data: base64Audio,
            mime_type: mimeType,
          },
          {
            type: 'text',
            text: promptText,
          },
        ],
      })
    );
    return (transcribeInteraction.output_text ?? '').trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isCapacityOrQuota =
      msg.includes('503') ||
      msg.includes('429') ||
      msg.includes('UNAVAILABLE') ||
      msg.includes('RESOURCE_EXHAUSTED') ||
      msg.toLowerCase().includes('high demand') ||
      msg.toLowerCase().includes('quota');
    if (!isCapacityOrQuota) {
      throw err;
    }

    const ai = getGeminiClient();
    const res = await withTransientRetry(() =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            { inlineData: { mimeType, data: base64Audio } },
            { text: promptText },
          ],
        },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      })
    );
    return (res.text ?? '').trim();
  }
}

export async function prepareSpokenTextForAi(
  transcript: string,
  targetLang: Language,
  mode: 'exact' | 'polish' | 'reply'
): Promise<string> {
  if (mode === 'exact') {
    return transcript;
  }
  const ai = getGeminiClient();
  const langLabel = targetLang === 'hi' ? 'Hindi (Devanagari script)' : 'English';
  const instruction =
    mode === 'reply'
      ? `The user spoke to you via microphone: "${transcript}". Reply helpfully, warmly, and concisely in ${langLabel} in 1-3 natural spoken sentences suitable for text-to-speech. Return only the spoken reply.`
      : `Clean up, fix minor speech disfluencies, and convert the user's spoken words into natural, broadcast-ready ${langLabel} preserving their exact meaning. Return only the final spoken script.\n\nSpoken transcript:\n${transcript}`;

  const res = await withTransientRetry(() =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: instruction,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    })
  );
  return (res.text ?? '').trim() || transcript;
}

export async function transcribeAudioToSubtitles(
  audioPath: string,
  mimeType: string,
  targetLanguage: string
): Promise<{ transcript: string; cues: SubtitleCue[] }> {
  const ai = getGeminiBetaClient();
  const transcript = await transcribeSpeechOnly(audioPath, mimeType);
  if (!transcript) {
    return { transcript: '', cues: [] };
  }

  const cueRes = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Convert this transcript into sequential subtitle cues (2 to 5 seconds each) in language "${targetLanguage}". If the transcript is in another language, translate naturally into "${targetLanguage}".\nTranscript:\n${transcript}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            startSec: { type: Type.NUMBER },
            endSec: { type: Type.NUMBER },
            text: { type: Type.STRING },
          },
          required: ['startSec', 'endSec', 'text'],
        },
      },
    },
  });

  const rawCues = JSON.parse((cueRes.text ?? '[]').trim()) as Array<{
    startSec: number;
    endSec: number;
    text: string;
  }>;

  const cues: SubtitleCue[] = rawCues.map((c, i) => ({
    id: `sub-${Date.now()}-${i}`,
    startSec: Math.max(0, Number(c.startSec) || i * 3),
    endSec: Math.max((Number(c.startSec) || i * 3) + 1.5, Number(c.endSec) || (i + 1) * 3),
    text: c.text,
  }));

  return { transcript, cues };
}

export async function translateText(text: string, targetLang: Language): Promise<string> {
  const ai = getGeminiClient();
  const res = await withTransientRetry(() =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Translate the following script or subtitle text naturally into ${
        targetLang === 'hi' ? 'Hindi (Devanagari script)' : 'English'
      }. Return only the translated text.\n\n${text}`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    })
  );
  return (res.text ?? '').trim();
}

export async function summarizeAndDirectVideo(params: {
  title: string;
  durationSec: number;
  sceneTimestamps: number[];
  transcript?: string;
  language: Language;
}): Promise<{
  summary: string;
  highlights: Array<{ startSec: number; endSec: number; reason: string }>;
  autoEditNotes: string[];
}> {
  const ai = getGeminiClient();
  const res = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Analyze this video metadata and produce a summary, highlight cut segments, and auto-edit recommendations in ${
      params.language === 'hi' ? 'Hindi' : 'English'
    }.
Title: ${params.title}
Total Duration: ${params.durationSec.toFixed(1)}s
Detected Scene Changes (sec): ${JSON.stringify(params.sceneTimestamps)}
Transcript: ${params.transcript || 'No spoken dialogue detected.'}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          highlights: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                startSec: { type: Type.NUMBER },
                endSec: { type: Type.NUMBER },
                reason: { type: Type.STRING },
              },
              required: ['startSec', 'endSec', 'reason'],
            },
          },
          autoEditNotes: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ['summary', 'highlights', 'autoEditNotes'],
      },
    },
  });

  return JSON.parse((res.text ?? '{}').trim());
}

export async function generateImageWithGemini(params: {
  prompt: string;
  modelId: 'gemini-3.1-flash-lite-image' | 'gemini-nano-banana-2.1';
  aspectRatio: string;
  imageSize?: '1K' | '2K' | '4K';
  sourceImageBase64?: string;
  sourceMimeType?: string;
}): Promise<{ buffer: Buffer; mimeType: string; textNote?: string }> {
  const ai = getGeminiClient();
  const parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = [];
  if (params.sourceImageBase64 && params.sourceMimeType) {
    parts.push({
      inlineData: {
        data: params.sourceImageBase64,
        mimeType: params.sourceMimeType,
      },
    });
  }
  parts.push({ text: params.prompt });

  const config: Record<string, unknown> = {
    imageConfig: {
      aspectRatio: params.aspectRatio === '4:5' ? '3:4' : params.aspectRatio === '21:9' ? '16:9' : params.aspectRatio,
      ...(params.modelId === 'gemini-nano-banana-2.1' && params.imageSize
        ? { imageSize: params.imageSize }
        : {}),
    },
  };

  const response = await ai.models.generateContent({
    model: params.modelId,
    contents: { parts },
    config,
  });

  let imgBuf: Buffer | null = null;
  let mime = 'image/png';
  let textNote = '';

  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) {
      imgBuf = Buffer.from(part.inlineData.data, 'base64');
      mime = part.inlineData.mimeType ?? 'image/png';
    } else if (part.text) {
      textNote += part.text;
    }
  }

  if (!imgBuf) {
    throw new Error('Model returned no image output.');
  }

  return { buffer: imgBuf, mimeType: mime, textNote };
}

export async function generateMusicWithLyria(params: {
  prompt: string;
  modelId: 'lyria-3-clip-preview' | 'lyria-3-pro-preview';
}): Promise<{ buffer: Buffer; mimeType: string; lyrics: string }> {
  const ai = getGeminiBetaClient();
  const response = await ai.models.generateContentStream({
    model: params.modelId,
    contents: params.prompt,
  });

  const audioChunks: Buffer[] = [];
  let lyrics = '';
  let mimeType = 'audio/mpeg';

  for await (const chunk of response) {
    const parts = chunk.candidates?.[0]?.content?.parts;
    if (!parts) continue;
    for (const part of parts) {
      if (part.inlineData?.data) {
        if (audioChunks.length === 0 && part.inlineData.mimeType) {
          mimeType = part.inlineData.mimeType;
        }
        audioChunks.push(Buffer.from(part.inlineData.data, 'base64'));
      }
      if (part.text) {
        lyrics += part.text;
      }
    }
  }

  if (audioChunks.length === 0) {
    throw new Error('No audio chunks returned from Lyria model.');
  }

  return { buffer: Buffer.concat(audioChunks), mimeType, lyrics };
}

export async function generateVideoWithOmniFlash(params: {
  prompt: string;
  aspectRatio: '16:9' | '9:16';
  durationSec: number;
  resolution: '720p' | '1080p' | '4k';
  imagePath?: string;
  imageMimeType?: string;
  videoPath?: string;
}): Promise<{ buffer: Buffer; mimeType: string; interactionId?: string }> {
  const ai = getGeminiBetaClient();
  const clampedDur = Math.min(15, Math.max(3, Math.round(params.durationSec)));

  let input: unknown = params.prompt;
  if (params.imagePath && fs.existsSync(params.imagePath)) {
    const base64 = fs.readFileSync(params.imagePath).toString('base64');
    input = [
      {
        type: 'image',
        mime_type: params.imageMimeType || 'image/jpeg',
        data: base64,
      },
      {
        type: 'text',
        text: params.prompt,
      },
    ];
  } else if (params.videoPath && fs.existsSync(params.videoPath)) {
    let uploaded = await ai.files.upload({
      file: params.videoPath,
      config: { mimeType: 'video/mp4' },
    });
    while (uploaded.state === 'PROCESSING') {
      await new Promise((r) => setTimeout(r, 4000));
      uploaded = await ai.files.get({ name: uploaded.name || '' });
    }
    if (uploaded.state === 'FAILED') {
      throw new Error('Uploaded reference video failed Gemini Files API processing.');
    }
    input = [
      { type: 'video', uri: uploaded.uri },
      { type: 'text', text: params.prompt },
    ];
  }

  const interaction = await ai.interactions.create(
    {
      model: 'gemini-omni-1.2-flash',
      input: input as string,
      background: false,
      store: false,
      stream: false,
      response_format: {
        type: 'video',
        aspect_ratio: params.aspectRatio,
        duration: `${clampedDur}s`,
        resolution: params.resolution,
      },
    } as never,
    { timeout: 300000 }
  );

  const videoPart = interaction.output_video;
  if (!videoPart || !videoPart.data) {
    throw new Error('gemini-omni-1.2-flash did not return video bytes.');
  }
  return {
    buffer: Buffer.from(videoPart.data, 'base64'),
    mimeType: videoPart.mime_type || 'video/mp4',
    interactionId: interaction.id,
  };
}
