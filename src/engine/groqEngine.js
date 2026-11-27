import { REGIONAL_LEXICON, encodeWav16kMono } from './audioUtils';

const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';

const HALLUCINATION_PATTERNS = [
  /^subt[ií]tulos realizados por/i,
  /^amara\.org/i,
  /^gracias por ver el v[ií]deo/i,
  /^suscr[ií]bete al canal/i,
  /^traducci[oó]n y subt[ií]tulos/i,
  /^\.+$/,
];

function isLikelyHallucination(seg) {
  const txt = (seg.text || '').trim();
  if (!txt) return true;
  if (HALLUCINATION_PATTERNS.some((rx) => rx.test(txt))) return true;
  if (
    typeof seg.no_speech_prob === 'number' &&
    seg.no_speech_prob > 0.88 &&
    typeof seg.avg_logprob === 'number' &&
    seg.avg_logprob < -1.1
  ) {
    return true;
  }
  return false;
}

function buildRegionalPrompt(region, customGlossary = []) {
  const slang = REGIONAL_LEXICON[region] || REGIONAL_LEXICON['Multi-LATAM'];
  const combined = Array.from(new Set([...customGlossary, ...slang])).filter(Boolean);
  const termsStr = combined.slice(0, 28).join(', ');
  return `Conversación en español de ${region}. Transcribir fielmente con puntuación clara. Términos frecuentes: ${termsStr}.`.slice(
    0,
    520
  );
}

export async function testGroqConnection(apiKey) {
  const cleanKey = (apiKey || '').trim();
  if (!cleanKey) {
    return { ok: false, message: 'Pega tu clave gratuita de Groq (empieza por gsk_).' };
  }
  try {
    const res = await fetch(GROQ_MODELS_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${cleanKey}`,
      },
    });
    if (res.ok) {
      return { ok: true, message: 'Conectado correctamente a Whisper Large-v3 (Gratis).' };
    }
    if (res.status === 401) {
      return { ok: false, message: 'Clave inválida. Verifica que la copiaste completa desde Groq.' };
    }
    return { ok: false, message: `Groq respondió con estado ${res.status}. Intenta de nuevo.` };
  } catch (err) {
    return { ok: false, message: 'Sin conexión a internet para verificar la clave.' };
  }
}

export async function transcribeWithGroq({
  samples,
  sampleRate = 16000,
  duration = 0,
  apiKey,
  model = 'whisper-large-v3-turbo',
  region = 'Multi-LATAM',
  glossary = [],
  onProgress,
}) {
  const cleanKey = (apiKey || '').trim();
  if (!cleanKey) {
    throw new Error('NO_GROQ_KEY');
  }

  // Dividir automáticamente si el audio supera 10 min (~19 MB en WAV 16kHz mono, bajo el límite de 25 MB)
  const maxChunkSec = 600;
  const maxChunkSamples = maxChunkSec * sampleRate;
  const totalParts = Math.max(1, Math.ceil(samples.length / maxChunkSamples));
  const prompt = buildRegionalPrompt(region, glossary);

  const allChunks = [];
  const allTexts = [];

  for (let part = 0; part < totalParts; part++) {
    const startIdx = part * maxChunkSamples;
    const endIdx = Math.min(samples.length, (part + 1) * maxChunkSamples);
    const slice = samples.subarray(startIdx, endIdx);
    const offsetSec = startIdx / sampleRate;

    if (onProgress) {
      const pct = 28 + Math.round(((part + 0.35) / totalParts) * 52);
      onProgress(
        pct,
        totalParts > 1
          ? `Transcribiendo bloque ${part + 1} de ${totalParts} con Whisper Large-v3...`
          : 'Transcribiendo en alta precisión con Whisper Large-v3...'
      );
    }

    const wavBlob = encodeWav16kMono(slice, sampleRate);
    const formData = new FormData();
    formData.append('file', wavBlob, `voxlatam_part_${part + 1}.wav`);
    formData.append('model', model);
    formData.append('language', 'es');
    formData.append('temperature', '0');
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities[]', 'segment');
    formData.append('prompt', prompt);

    const response = await fetch(GROQ_TRANSCRIBE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cleanKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      let detail = `Error ${response.status}`;
      try {
        const errJson = await response.json();
        detail = errJson?.error?.message || detail;
      } catch {
        // Ignorar parseo si no es JSON
      }
      if (response.status === 401) {
        throw new Error('INVALID_GROQ_KEY');
      }
      throw new Error(`GROQ_ERROR: ${detail}`);
    }

    const data = await response.json();
    const segments = Array.isArray(data.segments) ? data.segments : [];

    if (segments.length > 0) {
      for (const seg of segments) {
        if (isLikelyHallucination(seg)) continue;
        const cleanTxt = (seg.text || '').trim();
        const s = Math.max(0, Number(seg.start || 0) + offsetSec);
        const e = Math.min(
          duration || s + 4,
          Math.max(s + 0.25, Number(seg.end || s + 2) + offsetSec)
        );
        allChunks.push({
          text: cleanTxt,
          timestamp: [Number(s.toFixed(2)), Number(e.toFixed(2))],
        });
        allTexts.push(cleanTxt);
      }
    } else if (data.text && data.text.trim()) {
      const cleanTxt = data.text.trim();
      allChunks.push({
        text: cleanTxt,
        timestamp: [
          Number(offsetSec.toFixed(2)),
          Number(Math.min(duration || offsetSec + 5, endIdx / sampleRate).toFixed(2)),
        ],
      });
      allTexts.push(cleanTxt);
    }
  }

  return {
    text: allTexts.join(' ').trim(),
    chunks: allChunks,
    engineLabel: model === 'whisper-large-v3' ? '🎯 Large-v3' : '⚡ Large-v3 Turbo',
  };
}
