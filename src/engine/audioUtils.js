export const REGIONAL_LEXICON = {
  'Multi-LATAM': [
    'chévere', 'ahorita', 'chamba', 'pana', 'parce', 'vaina',
    'dale', 'listo', 'plata', 'reunión', 'acuerdo', 'entrega'
  ],
  Venezuela: [
    'chévere', 'chamo', 'chama', 'vaina', 'arrecho', 'pana', 'coroto',
    'ahorita', 'fino', 'chimbo', 'burda', 'chamba', 'conchale', 'vale'
  ],
  México: [
    'güey', 'chamba', 'neta', 'órale', 'chido', 'ahorita', 'feria',
    'lana', 'morro', 'padre', 'sale', 'bronca', 'cañón', 'banda'
  ],
  Colombia: [
    'parce', 'parcero', 'camello', 'bacano', 'chévere', 'vaina',
    'chimba', 'listo', 'hágale', 'plata', 'berraco', 'paila', 'quiubo'
  ],
  Argentina: [
    'che', 'boludo', 'laburo', 'quilombo', 'bárbaro', 'piola',
    'guita', 'posta', 'dale', 'macana', 'todo bien', 'banca'
  ],
  Chile: [
    'cachai', 'po', 'pega', 'fome', 'bacán', 'al tiro',
    'luca', 'pololo', 'cuático', 'filete', 'ya po'
  ],
};

export function formatMMSS(sec) {
  const safe = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export async function decodeAudioTo16kHzMono(blobOrFile) {
  const arrayBuffer = await blobOrFile.arrayBuffer();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const tempCtx = new AudioCtx();
  let audioBuffer;
  try {
    audioBuffer = await tempCtx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    if (tempCtx.state !== 'closed') {
      await tempCtx.close().catch(() => {});
    }
  }

  const targetRate = 16000;
  const targetLength = Math.max(1, Math.ceil(audioBuffer.duration * targetRate));
  const offlineCtx = new OfflineAudioContext(1, targetLength, targetRate);
  const src = offlineCtx.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(offlineCtx.destination);
  src.start(0);

  const rendered = await offlineCtx.startRendering();
  const channel = rendered.getChannelData(0);
  return {
    samples: new Float32Array(channel),
    sampleRate: targetRate,
    duration: audioBuffer.duration,
  };
}

function findSilenceSplitSec(samples, sr, approxSec, minSec, maxSec) {
  const winRadius = Math.floor(0.65 * sr);
  const centerIdx = Math.floor(approxSec * sr);
  const lowIdx = Math.max(Math.floor((minSec + 0.6) * sr), centerIdx - winRadius);
  const highIdx = Math.min(Math.floor((maxSec - 0.6) * sr), centerIdx + winRadius);
  if (highIdx - lowIdx < Math.floor(0.2 * sr)) return approxSec;

  const frameLen = Math.floor(0.05 * sr);
  const hop = Math.floor(0.025 * sr);
  let bestIdx = centerIdx;
  let minRms = Infinity;

  for (let i = lowIdx; i + frameLen <= highIdx; i += hop) {
    let sumSq = 0;
    for (let j = 0; j < frameLen; j++) {
      const v = samples[i + j];
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / frameLen);
    if (rms < minRms) {
      minRms = rms;
      bestIdx = i + Math.floor(frameLen / 2);
    }
  }
  return bestIdx / sr;
}

export function refineChunksIntoTurns(rawChunks, samples, sr, totalDuration) {
  if (!rawChunks || rawChunks.length === 0) return [];
  const turns = [];

  for (const ch of rawChunks) {
    const rawText = (ch.text || '').trim();
    if (!rawText) continue;
    const start = Math.max(0, Number(ch.timestamp?.[0] ?? 0));
    const rawEnd = ch.timestamp?.[1];
    const end = Math.min(
      totalDuration,
      rawEnd != null && rawEnd > start ? Number(rawEnd) : Math.min(totalDuration, start + 4.5)
    );
    const dur = Math.max(0.2, end - start);

    // Dividir turnos largos cuando hay oraciones separadas y pausa acústica
    const sentences = rawText
      .split(/(?<=[.?!¿¡])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (dur >= 4.4 && sentences.length >= 2) {
      let cursorStart = start;
      const totalChars = sentences.reduce((acc, s) => acc + s.length, 0) || 1;
      let accChars = 0;

      for (let i = 0; i < sentences.length; i++) {
        accChars += sentences[i].length;
        if (i < sentences.length - 1) {
          const propSec = start + (accChars / totalChars) * dur;
          const splitSec = findSilenceSplitSec(samples, sr, propSec, cursorStart, end);
          if (splitSec - cursorStart >= 0.8 && end - splitSec >= 0.8) {
            turns.push({
              start: Number(cursorStart.toFixed(2)),
              end: Number(splitSec.toFixed(2)),
              text: sentences[i],
            });
            cursorStart = splitSec;
          } else if (i + 1 < sentences.length) {
            sentences[i + 1] = `${sentences[i]} ${sentences[i + 1]}`;
          }
        } else {
          turns.push({
            start: Number(cursorStart.toFixed(2)),
            end: Number(end.toFixed(2)),
            text: sentences[i],
          });
        }
      }
    } else {
      turns.push({
        start: Number(start.toFixed(2)),
        end: Number(end.toFixed(2)),
        text: rawText,
      });
    }
  }
  return turns;
}

function goertzelBandEnergy(frame, sr, targetHz) {
  const N = frame.length;
  const k = Math.round((N * targetHz) / sr);
  const w = (2 * Math.PI * k) / N;
  const coeff = 2 * Math.cos(w);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < N; i++) {
    s0 = frame[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.max(1e-9, s1 * s1 + s2 * s2 - coeff * s1 * s2);
}

function estimateFramePitchHz(frame, sr) {
  const minLag = Math.floor(sr / 350); // ~350 Hz max
  const maxLag = Math.floor(sr / 75);  // ~75 Hz min
  const n = frame.length;
  let energy = 0;
  for (let i = 0; i < n; i++) energy += frame[i] * frame[i];
  if (energy < 1e-6) return null;

  let bestCorr = 0;
  let bestLag = 0;
  for (let lag = minLag; lag <= maxLag && lag < n; lag++) {
    let sum = 0;
    let e1 = 0;
    let e2 = 0;
    const limit = n - lag;
    for (let i = 0; i < limit; i += 2) {
      const a = frame[i];
      const b = frame[i + lag];
      sum += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    const denom = Math.sqrt(e1 * e2) + 1e-9;
    const corr = sum / denom;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }
  if (bestCorr < 0.32 || bestLag === 0) return null;
  return sr / bestLag;
}

export function extractVoiceProfile(samples, sr, startSec, endSec) {
  const sIdx = Math.max(0, Math.floor(startSec * sr));
  const eIdx = Math.min(samples.length, Math.ceil(endSec * sr));
  const clip = samples.subarray(sIdx, eIdx);

  const frameSize = 512; // 32ms @ 16kHz
  const hop = 256;
  const bandFreqs = [130, 260, 480, 850, 1450, 2300, 3400, 4800];

  if (clip.length < frameSize) {
    return {
      vector: [155, 25, 0.08, 0, 0, 0, 0, 0, 0, 0, 0],
      rms: 0.02,
      pitchStd: 14,
      highBandRatio: 0.15,
    };
  }

  const frames = [];
  let sumRms = 0;
  for (let i = 0; i + frameSize <= clip.length; i += hop) {
    const f = clip.subarray(i, i + frameSize);
    let sq = 0;
    for (let j = 0; j < frameSize; j++) sq += f[j] * f[j];
    const r = Math.sqrt(sq / frameSize);
    sumRms += r;
    frames.push({ data: f, rms: r });
  }

  const meanRms = sumRms / Math.max(1, frames.length);
  const voiced = frames.filter((f) => f.rms >= meanRms * 0.45);
  const activeFrames = voiced.length >= 2 ? voiced : frames;

  const step = Math.max(1, Math.floor(activeFrames.length / 24));
  const pitches = [];
  const bandAccum = new Array(bandFreqs.length).fill(0);
  let zcrSum = 0;
  let sampledCount = 0;

  for (let idx = 0; idx < activeFrames.length; idx += step) {
    const frame = activeFrames[idx].data;
    sampledCount++;

    const f0 = estimateFramePitchHz(frame, sr);
    if (f0 !== null) pitches.push(f0);

    let crossings = 0;
    for (let j = 1; j < frame.length; j++) {
      if ((frame[j] >= 0 && frame[j - 1] < 0) || (frame[j] < 0 && frame[j - 1] >= 0)) {
        crossings++;
      }
    }
    zcrSum += crossings / frame.length;

    const energies = bandFreqs.map((hz) => Math.log(goertzelBandEnergy(frame, sr, hz)));
    const avgLogE = energies.reduce((a, b) => a + b, 0) / energies.length;
    for (let b = 0; b < bandFreqs.length; b++) {
      bandAccum[b] += energies[b] - avgLogE;
    }
  }

  pitches.sort((a, b) => a - b);
  const medianPitch =
    pitches.length > 0 ? pitches[Math.floor(pitches.length / 2)] : 155;
  const pMean =
    pitches.length > 0 ? pitches.reduce((a, b) => a + b, 0) / pitches.length : medianPitch;
  const pitchStd =
    pitches.length > 2
      ? Math.sqrt(pitches.reduce((acc, v) => acc + (v - pMean) ** 2, 0) / pitches.length)
      : 14;
  const pIqr =
    pitches.length >= 4
      ? pitches[Math.floor(pitches.length * 0.75)] - pitches[Math.floor(pitches.length * 0.25)]
      : 20;

  const normBands = bandAccum.map((v) => v / Math.max(1, sampledCount));
  const meanZcr = zcrSum / Math.max(1, sampledCount);
  const highBandRatio = normBands[6] + normBands[7] - (normBands[0] + normBands[1]);

  return {
    vector: [medianPitch, pIqr, meanZcr, ...normBands],
    rms: meanRms,
    pitchStd,
    highBandRatio,
  };
}

function cosineDistance(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const sim = dot / (Math.sqrt(na * nb) + 1e-9);
  return 1 - Math.max(-1, Math.min(1, sim));
}

export function clusterSpeakersByVoice(segments, speakerMode = 'auto') {
  if (!segments || segments.length === 0) return [];
  if (segments.length === 1 || speakerMode === '1' || speakerMode === 1) {
    return segments.map(() => 'Hablante 1');
  }

  const rawVectors = segments.map((s) => s.voiceVector || [155, 20, 0.08, 0, 0, 0, 0, 0, 0, 0, 0]);
  const dim = rawVectors[0].length;

  // Pesos acústicos: mayor peso a F0 (tono fundamental) y formantes medios
  const weights = [2.4, 0.7, 0.9, 1.1, 1.3, 1.4, 1.4, 1.3, 1.2, 0.9, 0.8];

  const means = new Array(dim).fill(0);
  const stds = new Array(dim).fill(0);
  for (let d = 0; d < dim; d++) {
    for (let i = 0; i < rawVectors.length; i++) means[d] += rawVectors[i][d];
    means[d] /= rawVectors.length;
    for (let i = 0; i < rawVectors.length; i++) stds[d] += (rawVectors[i][d] - means[d]) ** 2;
    stds[d] = Math.sqrt(stds[d] / rawVectors.length) || 1;
  }

  const normVectors = rawVectors.map((vec) =>
    vec.map((val, d) => ((val - means[d]) / stds[d]) * (weights[d] ?? 1.0))
  );

  let clusters = normVectors.map((_, idx) => [idx]);
  const forcedTarget =
    speakerMode !== 'auto' ? Math.max(1, Math.min(segments.length, Number(speakerMode))) : null;
  const autoThreshold = 0.56;

  while (clusters.length > 1) {
    if (forcedTarget !== null && clusters.length <= forcedTarget) break;

    let bestPair = [-1, -1];
    let minDist = Infinity;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        // Average linkage
        let sumD = 0;
        let count = 0;
        for (const idxA of clusters[i]) {
          for (const idxB of clusters[j]) {
            sumD += cosineDistance(normVectors[idxA], normVectors[idxB]);
            count++;
          }
        }
        const avgD = sumD / count;
        if (avgD < minDist) {
          minDist = avgD;
          bestPair = [i, j];
        }
      }
    }

    if (forcedTarget === null && minDist > autoThreshold && clusters.length <= 5) {
      break;
    }

    const [c1, c2] = bestPair;
    clusters[c1] = [...clusters[c1], ...clusters[c2]];
    clusters.splice(c2, 1);
  }

  const rawAssignment = new Array(segments.length).fill(0);
  clusters.forEach((memberIndices, clusterIdx) => {
    memberIndices.forEach((segIdx) => {
      rawAssignment[segIdx] = clusterIdx;
    });
  });

  // Suavizar intervenciones ultracortas (< 0.9s) aisladas entre el mismo hablante
  for (let i = 1; i < rawAssignment.length - 1; i++) {
    const dur = (segments[i].end || 0) - (segments[i].start || 0);
    if (dur < 0.9 && rawAssignment[i - 1] === rawAssignment[i + 1]) {
      rawAssignment[i] = rawAssignment[i - 1];
    }
  }

  // Asignar Hablante 1, Hablante 2, Hablante 3 por orden cronológico de aparición
  const orderedMap = new Map();
  let nextNum = 1;
  return rawAssignment.map((cId) => {
    if (!orderedMap.has(cId)) {
      orderedMap.set(cId, `Hablante ${nextNum++}`);
    }
    return orderedMap.get(cId);
  });
}

export function classifyVoiceTone(profile, text, duration, baselineRms) {
  const relEnergy = (profile.rms || 0.02) / (baselineRms + 1e-6);
  const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
  const wps = words / Math.max(duration, 0.45);

  if (wps > 3.15 && relEnergy > 1.08) {
    return { label: 'Urgente', badge: '⚡ Tono urgente', code: 'urgent' };
  }
  if (relEnergy > 1.28 || (relEnergy > 1.12 && /[¡!]/.test(text))) {
    return { label: 'Enfático', badge: '🔥 Tono enfático', code: 'intense' };
  }
  if ((profile.pitchStd || 14) > 23 && relEnergy >= 0.92) {
    return { label: 'Entusiasta', badge: '✨ Tono entusiasta', code: 'enthusiastic' };
  }
  if (wps < 1.65 || text.includes('...')) {
    return { label: 'Pausado', badge: '🤔 Tono pausado', code: 'hesitant' };
  }
  if (relEnergy >= 0.9) {
    return { label: 'Firme', badge: '🎯 Tono firme', code: 'firm' };
  }
  return { label: 'Calmado', badge: '😌 Tono calmado', code: 'calm' };
}

export function applyGlossaryFixes(text, glossaryTerms) {
  if (!text || !glossaryTerms || glossaryTerms.length === 0) return text;
  let updated = text;
  for (const term of glossaryTerms) {
    const clean = term.trim();
    if (clean.length < 3) continue;
    const regex = new RegExp(`\\b${clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    updated = updated.replace(regex, clean);
  }
  return updated;
}

export function generateSmartNotes(segments, region, customTerms = []) {
  if (!segments || segments.length === 0) {
    return {
      summary: 'No se detectaron voces claras en este audio.',
      highlights: [],
      detectedSlang: [],
      speakerStats: {},
    };
  }

  const slangPool = [
    ...(REGIONAL_LEXICON[region] || REGIONAL_LEXICON['Multi-LATAM']),
    ...customTerms,
  ].map((s) => s.toLowerCase().trim()).filter(Boolean);

  const fullLower = segments.map((s) => s.text.toLowerCase()).join(' ');
  const detectedSlang = Array.from(new Set(slangPool)).filter((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-záéíóúüñ])${escaped}([^a-záéíóúüñ]|$)`, 'i').test(fullLower);
  });

  // Calcular tiempo hablado por persona
  const speakerDur = {};
  let totalSpoken = 0;
  for (const seg of segments) {
    const d = Math.max(0.4, (seg.end || 0) - (seg.start || 0));
    speakerDur[seg.speaker] = (speakerDur[seg.speaker] || 0) + d;
    totalSpoken += d;
  }

  const speakerStats = {};
  Object.entries(speakerDur).forEach(([spk, d]) => {
    speakerStats[spk] = Math.round((d / Math.max(0.1, totalSpoken)) * 100);
  });

  // Seleccionar frases clave con mayor peso informativo
  const scored = segments
    .map((s, index) => {
      const wc = s.text.split(/\s+/).length;
      const toneBoost = ['urgent', 'intense', 'firm'].includes(s.tone?.code) ? 1.3 : 1.0;
      return { ...s, index, score: wc * toneBoost };
    })
    .sort((a, b) => b.score - a.score);

  const topPicked = scored.slice(0, Math.min(4, scored.length)).sort((a, b) => a.index - b.index);
  const summary = topPicked
    .slice(0, 2)
    .map((s) => s.text)
    .join(' ');

  const highlights = topPicked.map((s) => ({
    speaker: s.speaker,
    timestamp: s.timestamp,
    start: s.start,
    text: s.text,
    toneBadge: s.tone?.badge || '',
  }));

  return {
    summary,
    highlights,
    detectedSlang,
    speakerStats,
  };
}


export function normalizeAudioSamples(samples) {
  if (!samples || samples.length === 0) return samples;
  const out = new Float32Array(samples.length);

  // 1. Eliminar desplazamiento DC (evita sesgos en grabaciones de Android)
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i];
  const mean = sum / samples.length;

  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const centered = samples[i] - mean;
    out[i] = centered;
    const abs = Math.abs(centered);
    if (abs > peak) peak = abs;
  }

  // 2. Normalizar volumen si la grabación quedó baja (sin amplificar silencio puro)
  if (peak > 0.004 && peak < 0.88) {
    const gain = Math.min(8.0, 0.92 / peak);
    for (let i = 0; i < out.length; i++) {
      const boosted = out[i] * gain;
      out[i] = boosted > 1 ? 1 : boosted < -1 ? -1 : boosted;
    }
  }

  return out;
}

export function encodeWav16kMono(samples, sampleRate = 16000) {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM
  view.setUint16(20, 1, true); // Linear PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
