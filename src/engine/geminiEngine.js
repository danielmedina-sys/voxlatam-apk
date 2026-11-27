import { REGIONAL_LEXICON, formatMMSS } from './audioUtils';

const AI_STUDIO_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Modelos priorizados: primero el más reciente (3.8) y respaldo automático si hay alta demanda
const DEFAULT_FALLBACK_MODELS = [
  'gemini-3.8-flash',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

const TONE_MAP = {
  urgent: { label: 'Urgente', badge: '⚡ Tono urgente', code: 'urgent' },
  intense: { label: 'Enfático', badge: '🔥 Tono enfático', code: 'intense' },
  enthusiastic: { label: 'Entusiasta', badge: '✨ Tono entusiasta', code: 'enthusiastic' },
  hesitant: { label: 'Pausado', badge: '🤔 Tono pausado', code: 'hesitant' },
  firm: { label: 'Firme', badge: '🎯 Tono firme', code: 'firm' },
  calm: { label: 'Calmado', badge: '😌 Tono calmado', code: 'calm' },
};

const MODEL_LABELS = {
  'gemini-3.8-flash': '🚀 Gemini 3.8 Flash',
  'gemini-2.5-flash': '✨ Gemini 2.5 Flash',
  'gemini-2.5-flash-lite': '⚡ Gemini 2.5 Lite',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCleanMimeType(blob, fileName = '') {
  const rawType = (blob?.type || '').split(';')[0].trim().toLowerCase();
  const ext = (fileName || '').split('.').pop()?.toLowerCase() || '';

  if (ext === 'mp3' || rawType === 'audio/mpeg') return 'audio/mp3';
  if (ext === 'wav' || rawType === 'audio/wav' || rawType === 'audio/x-wav') return 'audio/wav';
  if (ext === 'ogg' || ext === 'opus' || rawType === 'audio/ogg' || rawType === 'audio/opus') {
    return 'audio/ogg';
  }
  if (ext === 'm4a' || ext === 'mp4' || rawType === 'audio/mp4' || rawType === 'audio/x-m4a') {
    return 'audio/mp4';
  }
  if (ext === 'aac' || rawType === 'audio/aac') return 'audio/aac';
  if (ext === 'flac' || rawType === 'audio/flac') return 'audio/flac';
  if (ext === 'webm' || rawType === 'audio/webm') return 'audio/webm';

  if (rawType.startsWith('audio/')) return rawType;
  return 'audio/webm';
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      if (commaIdx === -1) {
        reject(new Error('No se pudo codificar el audio para enviarlo.'));
        return;
      }
      resolve(result.slice(commaIdx + 1));
    };
    reader.onerror = () => reject(new Error('Error leyendo el archivo de audio.'));
    reader.readAsDataURL(blob);
  });
}

function parseTimestampSec(val, fallback = 0) {
  if (typeof val === 'number' && Number.isFinite(val)) return Math.max(0, val);
  if (typeof val === 'string') {
    const clean = val.trim();
    if (/^\d+(\.\d+)?$/.test(clean)) return Math.max(0, parseFloat(clean));
    const parts = clean.split(':').map((p) => parseFloat(p));
    if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
      return Math.max(0, parts[0] * 60 + parts[1]);
    }
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
    }
  }
  return Math.max(0, fallback);
}

function normalizeTone(toneCode, toneLabel) {
  const code = String(toneCode || '').toLowerCase().trim();
  if (TONE_MAP[code]) return TONE_MAP[code];
  const lbl = String(toneLabel || '').toLowerCase();
  if (lbl.includes('urgen') || lbl.includes('rápid') || lbl.includes('apuro')) return TONE_MAP.urgent;
  if (lbl.includes('enfá') || lbl.includes('molest') || lbl.includes('enoj') || lbl.includes('tens')) {
    return TONE_MAP.intense;
  }
  if (lbl.includes('entusias') || lbl.includes('alegr') || lbl.includes('emocion')) {
    return TONE_MAP.enthusiastic;
  }
  if (lbl.includes('pausad') || lbl.includes('dud') || lbl.includes('pensat')) {
    return TONE_MAP.hesitant;
  }
  if (lbl.includes('firm') || lbl.includes('segur') || lbl.includes('serio')) return TONE_MAP.firm;
  return TONE_MAP.calm;
}

function extractJsonPayload(rawText) {
  const cleaned = String(rawText || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }
    throw new Error('La respuesta del modelo no tuvo formato estructurado válido.');
  }
}

function buildUnifiedPrompt(region, glossary = [], speakerMode = 'auto', durationSec = 0) {
  const slang = REGIONAL_LEXICON[region] || REGIONAL_LEXICON['Multi-LATAM'];
  const customTerms = Array.isArray(glossary) ? glossary.filter(Boolean) : [];
  const allTerms = Array.from(new Set([...customTerms, ...slang])).slice(0, 35);

  const speakerRule =
    speakerMode === '1'
      ? 'Hay exactamente 1 persona hablando: etiqueta todas las intervenciones como "Hablante 1".'
      : speakerMode !== 'auto'
      ? `Identifica hasta ${speakerMode} personas distintas según su timbre de voz y etiquétalas estrictamente como "Hablante 1", "Hablante 2", etc.`
      : 'Detecta automáticamente cuántas voces distintas participan en el audio y etiquétalas por orden de aparición estrictamente como "Hablante 1", "Hablante 2", "Hablante 3", etc. Si solo habla una persona, usa únicamente "Hablante 1".';

  const durationHint =
    durationSec > 0 ? `Duración aproximada del audio: ${durationSec.toFixed(1)} segundos.` : '';

  return [
    'Eres un transcriptor profesional experto en español latinoamericano.',
    'Escucha el audio completo y devuelve ÚNICAMENTE un objeto JSON válido con la transcripción literal exacta, separación de voces, tono acústico y resumen.',
    '',
    'REGLAS ESTRICTAS:',
    '1. Transcribe palabra por palabra en español con puntuación natural y ortografía clara. NO inventes frases ni rellenes silencios.',
    `2. Región/acento seleccionado: ${region}. Respeta fielmente modismos, expresiones coloquiales y nombres propios sin corregirlos a español neutro.`,
    allTerms.length > 0 ? `3. Glosario y modismos de referencia: ${allTerms.join(', ')}.` : '',
    `4. ${speakerRule}`,
    '5. Evalúa el tono REAL de la voz en cada intervención y usa exclusivamente uno de estos códigos en "tone_code": "urgent", "intense", "enthusiastic", "hesitant", "firm" o "calm".',
    '6. Incluye "start" y "end" en segundos numéricos reales para cada intervención (por ejemplo 0.0, 4.5).',
    durationHint,
    '',
    'ESQUEMA JSON OBLIGATORIO:',
    '{',
    '  "segments": [',
    '    {',
    '      "start": 0.0,',
    '      "end": 5.2,',
    '      "speaker": "Hablante 1",',
    '      "tone_code": "firm",',
    '      "text": "Texto exacto hablado en este segmento."',
    '    }',
    '  ],',
    '  "summary": "Resumen claro y conciso en 1 a 3 oraciones de lo tratado en el audio.",',
    '  "detected_slang": ["modismo1", "termino2"]',
    '}',
  ]
    .filter(Boolean)
    .join('\n');
}

function getDiscoveredModels() {
  try {
    const saved = JSON.parse(localStorage.getItem('vox_gemini_discovered') || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

export async function testGeminiConnection(apiKey) {
  const cleanKey = (apiKey || '').trim();
  if (!cleanKey) {
    return { ok: false, message: 'Pega tu clave de Google AI Studio (empieza por AQ. o AIza...).' };
  }

  try {
    // Usar cabecera x-goog-api-key (requerida oficialmente para las nuevas claves AQ. de AI Studio)
    const res = await fetch(`${AI_STUDIO_BASE}/models`, {
      method: 'GET',
      headers: {
        'x-goog-api-key': cleanKey,
      },
    });

    if (!res.ok) {
      let errMsg = '';
      try {
        const errJson = await res.json();
        errMsg = errJson?.error?.message || '';
      } catch {
        // ignorar
      }
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return {
          ok: false,
          message:
            errMsg ||
            'Clave inválida. Abre el detalle de la clave en Google AI Studio y usa el botón "Copiar clave" (debe tener ~53 caracteres).',
        };
      }
      return {
        ok: false,
        message: `Google respondió con estado ${res.status}${errMsg ? `: ${errMsg}` : ''}.`,
      };
    }

    const data = await res.json();
    const models = Array.isArray(data.models) ? data.models : [];
    const flashModels = models
      .filter((m) => {
        const name = (m.name || '').toLowerCase();
        const methods = m.supportedGenerationMethods || [];
        return (
          methods.includes('generateContent') &&
          name.includes('flash') &&
          !name.includes('tts') &&
          !name.includes('image') &&
          !name.includes('embedding') &&
          !name.includes('live') &&
          !name.includes('exp')
        );
      })
      .map((m) => String(m.name || '').replace(/^models\//, ''))
      .sort((a, b) => b.localeCompare(a));

    if (flashModels.length > 0) {
      try {
        localStorage.setItem('vox_gemini_discovered', JSON.stringify(flashModels.slice(0, 6)));
      } catch {
        // ignorar
      }
    }

    return {
      ok: true,
      models: flashModels,
      message:
        flashModels.length > 0
          ? `Conectado a Google AI Studio (${flashModels.length} modelos Flash listos: ${flashModels[0]}).`
          : 'Conectado correctamente a Google AI Studio.',
    };
  } catch {
    return { ok: false, message: 'Sin conexión a internet para verificar la clave.' };
  }
}

async function uploadLargeAudioToGemini(blob, mimeType, apiKey) {
  const res = await fetch(
    '[https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=media](https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=media)',
    {
      method: 'POST',
      headers: {
        'Content-Type': mimeType,
        'x-goog-api-key': apiKey,
      },
      body: blob,
    }
  );

  if (!res.ok) {
    throw new Error(`UPLOAD_FAILED_${res.status}`);
  }

  const data = await res.json();
  const fileInfo = data.file || data;
  if (!fileInfo?.uri) {
    throw new Error('UPLOAD_NO_URI');
  }

  let current = fileInfo;
  let tries = 0;
  while (current.state === 'PROCESSING' && tries < 10) {
    await sleep(1200);
    tries++;
    const check = await fetch(`${AI_STUDIO_BASE}/${current.name}`, {
      headers: { 'x-goog-api-key': apiKey },
    });
    if (check.ok) {
      current = await check.json();
    } else {
      break;
    }
  }

  return current;
}

async function deleteUploadedGeminiFile(fileName, apiKey) {
  if (!fileName) return;
  try {
    await fetch(`${AI_STUDIO_BASE}/${fileName}`, {
      method: 'DELETE',
      headers: { 'x-goog-api-key': apiKey },
    });
  } catch {
    // Limpieza silenciosa
  }
}

function buildModelQueue(preferredModel) {
  const discovered = getDiscoveredModels();
  const list = [];

  if (preferredModel && preferredModel !== 'auto') {
    list.push(preferredModel);
  }
  for (const m of DEFAULT_FALLBACK_MODELS) {
    if (!list.includes(m)) list.push(m);
  }
  for (const m of discovered) {
    if (!list.includes(m)) list.push(m);
  }
  return list;
}

export async function transcribeWithGemini({
  blob,
  fileName = '',
  duration = 0,
  apiKey,
  preferredModel = 'auto',
  region = 'Multi-LATAM',
  glossary = [],
  speakerMode = 'auto',
  onProgress,
}) {
  const cleanKey = (apiKey || '').trim();
  if (!cleanKey) {
    throw new Error('NO_GEMINI_KEY');
  }

  const mimeType = getCleanMimeType(blob, fileName);
  const promptText = buildUnifiedPrompt(region, glossary, speakerMode, duration);

  let audioPart = null;
  let uploadedFileName = null;

  try {
    if (blob.size <= 14 * 1024 * 1024) {
      if (onProgress) onProgress(30, 'Preparando audio en una sola petición optimizada...');
      const b64 = await blobToBase64(blob);
      audioPart = {
        inlineData: {
          mimeType,
          data: b64,
        },
      };
    } else {
      if (onProgress) onProgress(28, 'Subiendo audio extenso a Google AI Studio...');
      const uploaded = await uploadLargeAudioToGemini(blob, mimeType, cleanKey);
      uploadedFileName = uploaded.name || null;
      audioPart = {
        fileData: {
          mimeType: uploaded.mimeType || mimeType,
          fileUri: uploaded.uri,
        },
      };
    }

    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [{ text: promptText }, audioPart],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    };

    const queue = buildModelQueue(preferredModel);
    let lastError = null;
    let successfulData = null;
    let usedModel = queue[0];

    for (let i = 0; i < queue.length; i++) {
      const modelName = queue[i];
      const friendlyName = MODEL_LABELS[modelName] || `✨ ${modelName}`;

      if (onProgress) {
        onProgress(
          Math.min(82, 42 + i * 12),
          i === 0
            ? `Transcribiendo voces y tonos con ${friendlyName} (1 sola llamada)...`
            : `Cambiando automáticamente a modelo de respaldo (${friendlyName})...`
        );
      }

      const url = `${AI_STUDIO_BASE}/models/${encodeURIComponent(modelName)}:generateContent`;

      let response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': cleanKey,
          },
          body: JSON.stringify(requestBody),
        });
      } catch {
        lastError = new Error('NETWORK_ERROR');
        break;
      }

      if (response.ok) {
        successfulData = await response.json();
        usedModel = modelName;
        break;
      }

      if (response.status === 400 || response.status === 401 || response.status === 403) {
        let msg = '';
        try {
          const errJson = await response.json();
          msg = errJson?.error?.message || '';
        } catch {
          // ignore
        }
        if (
          response.status === 401 ||
          response.status === 403 ||
          msg.toLowerCase().includes('api key')
        ) {
          throw new Error('INVALID_GEMINI_KEY');
        }
        lastError = new Error(`GEMINI_BAD_REQUEST: ${msg}`);
        continue;
      }

      // 429 (Cuota), 503 (Alta demanda), 404 (Modelo no disponible): rotar silenciosamente al respaldo
      if (response.status === 429 || response.status === 503 || response.status === 404) {
        lastError = new Error(`MODEL_BUSY_${response.status}`);
        if (i < queue.length - 1) {
          await sleep(1000);
          continue;
        }
      } else {
        lastError = new Error(`GEMINI_HTTP_${response.status}`);
      }
    }

    if (!successfulData) {
      throw lastError || new Error('ALL_GEMINI_MODELS_UNAVAILABLE');
    }

    const parts = successfulData?.candidates?.[0]?.content?.parts || [];
    const rawText = parts.map((p) => p.text || '').join('\n').trim();
    if (!rawText) {
      throw new Error('EMPTY_GEMINI_RESPONSE');
    }

    const parsed = extractJsonPayload(rawText);
    const rawSegments = Array.isArray(parsed.segments) ? parsed.segments : [];

    const speakerOrder = new Map();
    let spkCounter = 1;

    const cleanSegments = rawSegments
      .filter((s) => s && String(s.text || '').trim().length > 0)
      .map((s, idx) => {
        const rawSpk = String(s.speaker || 'Hablante 1').trim();
        let canonicalSpeaker = rawSpk;
        if (!/^Hablante\s+\d+$/i.test(rawSpk)) {
          if (!speakerOrder.has(rawSpk)) {
            speakerOrder.set(rawSpk, `Hablante ${spkCounter++}`);
          }
          canonicalSpeaker = speakerOrder.get(rawSpk);
        } else {
          const numMatch = rawSpk.match(/\d+/);
          canonicalSpeaker = `Hablante ${numMatch ? numMatch[0] : 1}`;
        }

        const estStart = parseTimestampSec(s.start, idx * 3);
        const estEndRaw = parseTimestampSec(s.end, estStart + 3.5);
        const clampedStart = duration > 0 ? Math.min(duration, estStart) : estStart;
        const clampedEnd =
          duration > 0
            ? Math.min(duration, Math.max(clampedStart + 0.3, estEndRaw))
            : Math.max(clampedStart + 0.3, estEndRaw);

        return {
          id: `seg_${idx}`,
          start: Number(clampedStart.toFixed(2)),
          end: Number(clampedEnd.toFixed(2)),
          timestamp: formatMMSS(clampedStart),
          speaker: canonicalSpeaker,
          tone: normalizeTone(s.tone_code, s.tone_label),
          text: String(s.text).trim(),
        };
      });

    return {
      segments: cleanSegments,
      summary: String(parsed.summary || '').trim(),
      detectedSlang: Array.isArray(parsed.detected_slang)
        ? parsed.detected_slang.map((w) => String(w).trim()).filter(Boolean)
        : [],
      engineLabel: MODEL_LABELS[usedModel] || `✨ ${usedModel}`,
    };
  } finally {
    if (uploadedFileName) {
      deleteUploadedGeminiFile(uploadedFileName, cleanKey);
    }
  }
}
