import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Mic,
  Square,
  Pause,
  Play,
  Upload,
  Palette,
  Cpu,
  Plus,
  X,
  Check,
  Edit3,
  Copy,
  Share2,
  Download,
  Trash2,
  Sparkles,
  Volume2,
  FolderOpen,
  Sun,
  Moon,
  RefreshCw,
  Users,
  FileText,
  MessageSquare,
  Zap,
  WifiOff,
  KeyRound,
  ExternalLink,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  REGIONAL_LEXICON,
  formatMMSS,
  decodeAudioTo16kHzMono,
  normalizeAudioSamples,
  refineChunksIntoTurns,
  extractVoiceProfile,
  clusterSpeakersByVoice,
  classifyVoiceTone,
  applyGlossaryFixes,
  generateSmartNotes,
} from './engine/audioUtils';
import {
  saveSessionToVault,
  getAllVaultSessions,
  deleteVaultSession,
} from './engine/storage';
import {
  transcribeWithGemini,
  testGeminiConnection,
} from './engine/geminiEngine';

const REGIONS = [
  { id: 'Multi-LATAM', flag: '🌎', label: 'Multi-LATAM' },
  { id: 'Venezuela', flag: '🇻🇪', label: 'Venezuela' },
  { id: 'México', flag: '🇲🇽', label: 'México' },
  { id: 'Colombia', flag: '🇨🇴', label: 'Colombia' },
  { id: 'Argentina', flag: '🇦🇷', label: 'Argentina' },
  { id: 'Chile', flag: '🇨🇱', label: 'Chile' },
];

const COLOR_PRESETS = [
  { name: 'Esmeralda', primary: '#10B981', secondary: '#06B6D4' },
  { name: 'Violeta Neón', primary: '#8B5CF6', secondary: '#EC4899' },
  { name: 'Ámbar Solar', primary: '#F59E0B', secondary: '#EF4444' },
  { name: 'Azul Eléctrico', primary: '#3B82F6', secondary: '#2DD4BF' },
  { name: 'Rosa Coral', primary: '#F43F5E', secondary: '#FB923C' },
];

const SPEAKER_PALETTE = [
  '#10B981',
  '#38BDF8',
  '#F59E0B',
  '#EC4899',
  '#A78BFA',
  '#FB7185',
];

const GEMINI_MODELS = [
  {
    id: 'auto',
    name: 'Automático Inteligente',
    tag: 'Recomendado · Anti-cuota',
    desc: 'Usa Gemini 2.5 Flash en 1 sola llamada y rota solo a modelos de respaldo si hay alta demanda.',
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    tag: 'Máxima precisión · 98%',
    desc: 'Excelente reconocimiento de voces múltiples, tonos y modismos latinos.',
  },
  {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash-Lite',
    tag: 'Mayor cuota gratis',
    desc: 'Ultra rápido y con límites gratuitos más amplios para uso intensivo diario.',
  },
];

const MODELS = [
  {
    id: 'Xenova/whisper-tiny',
    name: 'Ultraligero (Whisper Tiny)',
    size: '~40 MB',
    desc: 'Respaldo veloz sin internet para teléfonos con poca memoria.',
  },
  {
    id: 'Xenova/whisper-base',
    name: 'Equilibrado (Whisper Base)',
    size: '~74 MB',
    desc: 'Respaldo offline equilibrado si te quedas sin señal.',
  },
  {
    id: 'Xenova/whisper-small',
    name: 'Alta Precisión Offline (Whisper Small)',
    size: '~240 MB',
    desc: 'Mayor precisión sin internet. Requiere 6 GB+ de RAM.',
  },
];

function getSpeakerColor(speakerLabel) {
  const match = String(speakerLabel || '').match(/(\d+)/);
  const idx = match ? Math.max(0, parseInt(match[1], 10) - 1) : 0;
  return SPEAKER_PALETTE[idx % SPEAKER_PALETTE.length];
}

export default function App() {
  // Preferencias visuales persistentes (Negro AMOLED por defecto + Modo Claro + Color Libre)
  const [themeMode, setThemeMode] = useState(() => localStorage.getItem('vox_theme') || 'amoled');
  const [primaryColor, setPrimaryColor] = useState(
    () => localStorage.getItem('vox_primary') || '#10B981'
  );
  const [secondaryColor, setSecondaryColor] = useState(
    () => localStorage.getItem('vox_secondary') || '#06B6D4'
  );
  const [engineMode, setEngineMode] = useState(
    () => localStorage.getItem('vox_engine_mode') || 'hybrid'
  );
  const [geminiApiKey, setGeminiApiKey] = useState(
    () => localStorage.getItem('vox_gemini_key') || ''
  );
  const [geminiModel, setGeminiModel] = useState(
    () => localStorage.getItem('vox_gemini_model') || 'auto'
  );
  const [showKeyText, setShowKeyText] = useState(false);
  const [testingGemini, setTestingGemini] = useState(false);
  const [geminiTestStatus, setGeminiTestStatus] = useState(null);
  const [modelId, setModelId] = useState(
    () => localStorage.getItem('vox_model') || 'Xenova/whisper-small'
  );

  // Navegación (3 pestañas limpias sin Agenda: Grabar, Diálogos, Notas)
  const [activeTab, setActiveTab] = useState('record');
  const [showThemeModal, setShowThemeModal] = useState(false);
  const [showEngineModal, setShowEngineModal] = useState(false);
  const [showGlossaryModal, setShowGlossaryModal] = useState(false);
  const [showVaultModal, setShowVaultModal] = useState(false);

  // Configuración de captura e idioma
  const [selectedRegion, setSelectedRegion] = useState('Multi-LATAM');
  const [speakerMode, setSpeakerMode] = useState('auto');
  const [glossaryInput, setGlossaryInput] = useState('');
  const [customGlossary, setCustomGlossary] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('vox_glossary') || '[]');
    } catch {
      return [];
    }
  });

  // Estado de grabación en vivo
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [waveBars, setWaveBars] = useState(() => new Array(28).fill(14));

  // Estado del motor IA local (sin API externa)
  const [isProcessing, setIsProcessing] = useState(false);
  const [processMessage, setProcessMessage] = useState('');
  const [processProgress, setProcessProgress] = useState(0);
  const [toastMessage, setToastMessage] = useState('');

  // Sesiones y sesión actual
  const [vaultSessions, setVaultSessions] = useState([]);
  const [currentSession, setCurrentSession] = useState(null);
  const [editingSpeaker, setEditingSpeaker] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  // Reproductor sincronizado
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [audioObjectUrl, setAudioObjectUrl] = useState(null);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const animFrameRef = useRef(null);
  const audioCtxRef = useRef(null);
  const wakeLockRef = useRef(null);
  const workerRef = useRef(null);
  const audioPlayerRef = useRef(null);
  const fileInputRef = useRef(null);

  const isLight = themeMode === 'light';

  useEffect(() => {
    localStorage.setItem('vox_theme', themeMode);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', isLight ? '#F8FAFC' : '#000000');
  }, [themeMode, isLight]);

  useEffect(() => {
    localStorage.setItem('vox_primary', primaryColor);
    localStorage.setItem('vox_secondary', secondaryColor);
  }, [primaryColor, secondaryColor]);

  useEffect(() => {
    localStorage.setItem('vox_model', modelId);
  }, [modelId]);

  useEffect(() => {
    localStorage.setItem('vox_engine_mode', engineMode);
  }, [engineMode]);

  useEffect(() => {
    localStorage.setItem('vox_gemini_key', geminiApiKey.trim());
  }, [geminiApiKey]);

  useEffect(() => {
    localStorage.setItem('vox_gemini_model', geminiModel);
  }, [geminiModel]);

  useEffect(() => {
    localStorage.setItem('vox_glossary', JSON.stringify(customGlossary));
  }, [customGlossary]);

  // Cargar historial local del teléfono al iniciar
  useEffect(() => {
    getAllVaultSessions()
      .then((list) => {
        setVaultSessions(list);
        if (list.length > 0) {
          setCurrentSession(list[0]);
        }
      })
      .catch(() => {});
  }, []);

  // Actualizar URL de audio cuando cambia la sesión activa
  useEffect(() => {
    if (currentSession?.audioBlob) {
      const url = URL.createObjectURL(currentSession.audioBlob);
      setAudioObjectUrl(url);
      setPlaybackTime(0);
      setIsPlayingAudio(false);
      return () => URL.revokeObjectURL(url);
    } else {
      setAudioObjectUrl(null);
    }
  }, [currentSession?.id]);

  // Inicializar Web Worker del motor IA On-Device
  const getWorker = () => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('./engine/aiWorker.js', import.meta.url), {
        type: 'module',
      });
    }
    return workerRef.current;
  };

  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? '' : prev));
    }, 3400);
  };

  const acquireWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
      }
    } catch {
      // Ignorar si el navegador no lo soporta
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
        },
      });

      await acquireWakeLock();
      audioChunksRef.current = [];
      setRecordSeconds(0);
      setIsPaused(false);

      // Espectro de ondas reales en vivo
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateWaveform = () => {
        analyser.getByteFrequencyData(dataArray);
        const bars = [];
        for (let i = 0; i < 28; i++) {
          const val = dataArray[i % dataArray.length] || 0;
          bars.push(Math.max(10, Math.min(96, Math.round((val / 255) * 95))));
        }
        setWaveBars(bars);
        animFrameRef.current = requestAnimationFrame(updateWaveform);
      };
      animFrameRef.current = requestAnimationFrame(updateWaveform);

      const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ];
      const mimeType = candidates.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
          audioCtxRef.current.close().catch(() => {});
        }
        releaseWakeLock();
        setWaveBars(new Array(28).fill(14));

        const finalBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        if (finalBlob.size > 500) {
          await processAudioBlob(
            finalBlob,
            `Grabación · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
          );
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setIsRecording(true);

      timerRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      showToast('Permite el acceso al micrófono para poder grabar.');
    }
  };

  const togglePauseRecording = () => {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    if (rec.state === 'recording') {
      rec.pause();
      setIsPaused(true);
      if (timerRef.current) clearInterval(timerRef.current);
    } else if (rec.state === 'paused') {
      rec.resume();
      setIsPaused(false);
      timerRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    }
  };

  const stopRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);
    setIsPaused(false);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const cleanName = file.name.replace(/\.[^/.]+$/, '');
    await processAudioBlob(file, cleanName);
  };

  const processAudioBlob = async (blob, title) => {
    const sessionId = `vox_${Date.now()}`;
    setIsProcessing(true);
    setProcessProgress(5);
    setProcessMessage('Guardando audio en la bóveda del teléfono...');

    // 1. Guardar inmediatamente en la bóveda local anti-pérdidas
    const draftSession = {
      id: sessionId,
      title,
      createdAt: Date.now(),
      region: selectedRegion,
      status: 'pending',
      duration: recordSeconds || 0,
      durationFormatted: formatMMSS(recordSeconds || 0),
      audioBlob: blob,
      speakerAliases: {},
      speakerMode,
      segments: [],
      notes: {
        summary: 'Audio resguardado en memoria. Pendiente de transcripción.',
        highlights: [],
        detectedSlang: [],
        speakerStats: {},
      },
    };

    try {
      await saveSessionToVault(draftSession);
      setVaultSessions((prev) => [draftSession, ...prev.filter((x) => x.id !== sessionId)]);
      setCurrentSession(draftSession);
    } catch {
      // Continuar incluso si IndexedDB está restringido
    }

    try {
      // 2. Decodificar y normalizar audio a 16kHz Mono (tolerante a formatos especiales de WhatsApp)
      setProcessMessage('Optimizando volumen y preparando audio...');
      setProcessProgress(14);

      let samples = null;
      let sampleRate = 16000;
      let duration = recordSeconds || 0;

      try {
        const decoded = await decodeAudioTo16kHzMono(blob);
        samples = normalizeAudioSamples(decoded.samples);
        sampleRate = decoded.sampleRate;
        duration = decoded.duration;
      } catch {
        // Si Android WebView no decodifica un códec especial (ej. .opus), Gemini igual lo procesa directo
        samples = null;
      }

      // Función auxiliar de respaldo Offline (en el teléfono)
      const runOfflineTranscription = () => {
        if (!samples) {
          return Promise.reject(
            new Error(
              'Este formato de audio requiere el modo Google AI Studio (con internet) para procesarse.'
            )
          );
        }
        return new Promise((resolve, reject) => {
          const worker = getWorker();
          const handleMsg = (ev) => {
            const data = ev.data;
            if (data.id !== sessionId) return;
            if (data.status === 'loading_model' || data.status === 'downloading') {
              setProcessMessage(data.message);
              setProcessProgress(Math.max(18, Math.min(82, data.progress || 35)));
            } else if (data.status === 'transcribing') {
              setProcessMessage(data.message);
              setProcessProgress(86);
            } else if (data.status === 'done') {
              worker.removeEventListener('message', handleMsg);
              resolve(data.result);
            } else if (data.status === 'error') {
              worker.removeEventListener('message', handleMsg);
              reject(new Error(data.error));
            }
          };
          worker.addEventListener('message', handleMsg);
          worker.postMessage({
            id: sessionId,
            type: 'TRANSCRIBE',
            audioSamples: samples,
            duration,
            modelId,
          });
        });
      };

      const slangPool = [
        ...(REGIONAL_LEXICON[selectedRegion] || REGIONAL_LEXICON['Multi-LATAM']),
        ...customGlossary,
      ].map((w) => w.toLowerCase());

      // 3. Intentar primero con Google AI Studio (1 sola petición unificada + rotación automática de modelos)
      let geminiResult = null;
      const canUseGemini =
        engineMode === 'hybrid' && geminiApiKey.trim().length > 15 && navigator.onLine !== false;

      if (canUseGemini) {
        try {
          setProcessMessage('Conectando con Google AI Studio (1 sola llamada)...');
          setProcessProgress(24);
          geminiResult = await transcribeWithGemini({
            blob,
            fileName: blob.name || title || 'audio.webm',
            duration,
            apiKey: geminiApiKey,
            preferredModel: geminiModel,
            region: selectedRegion,
            glossary: customGlossary,
            speakerMode,
            onProgress: (pct, msg) => {
              setProcessProgress(pct);
              setProcessMessage(msg);
            },
          });
        } catch (gemErr) {
          if (gemErr?.message === 'INVALID_GEMINI_KEY') {
            showToast('API Key inválida: revísala en el botón del Chip. Usando respaldo offline...');
          } else {
            showToast('Servidores ocupados o sin red: usando respaldo offline automático...');
          }
          geminiResult = null;
        }
      }

      let enrichedSegments = [];
      let smartNotes = null;
      let engineLabel = '📱 Offline Local';

      if (geminiResult) {
        setProcessMessage('Organizando diálogos, tonos y notas...');
        setProcessProgress(94);
        engineLabel = geminiResult.engineLabel || '✨ Gemini Flash';

        enrichedSegments = (geminiResult.segments || []).map((seg, idx) => {
          const cleanText = applyGlossaryFixes(seg.text, customGlossary);
          const profile = samples
            ? extractVoiceProfile(samples, sampleRate, seg.start, seg.end)
            : null;
          const slangHits = slangPool.filter((term) => {
            if (!term) return false;
            const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`(^|[^a-záéíóúüñ])${escaped}([^a-záéíóúüñ]|$)`, 'i').test(
              cleanText.toLowerCase()
            );
          });

          return {
            id: `seg_${idx}`,
            start: seg.start,
            end: seg.end,
            timestamp: seg.timestamp || formatMMSS(seg.start),
            speaker: seg.speaker || 'Hablante 1',
            text: cleanText,
            voiceVector: profile?.vector || [155, 20, 0.08, 0, 0, 0, 0, 0, 0, 0, 0],
            tone: seg.tone,
            slangHits: Array.from(new Set(slangHits)),
          };
        });

        if (duration <= 0 && enrichedSegments.length > 0) {
          duration = enrichedSegments[enrichedSegments.length - 1].end || 0;
        }

        const baseNotes = generateSmartNotes(enrichedSegments, selectedRegion, customGlossary);
        smartNotes = {
          ...baseNotes,
          summary: geminiResult.summary || baseNotes.summary,
          detectedSlang: Array.from(
            new Set([...(baseNotes.detectedSlang || []), ...(geminiResult.detectedSlang || [])])
          ),
        };
      } else {
        // 4. Respaldo Offline (en el teléfono)
        const whisperOutput = await runOfflineTranscription();
        engineLabel = whisperOutput?.engineLabel || '📱 Offline Local';

        setProcessMessage('Separando hablantes y midiendo tonos de voz...');
        setProcessProgress(94);

        const rawChunks =
          whisperOutput?.chunks && whisperOutput.chunks.length > 0
            ? whisperOutput.chunks
            : whisperOutput?.text
            ? [{ text: whisperOutput.text, timestamp: [0, duration] }]
            : [];

        const turns = refineChunksIntoTurns(rawChunks, samples, sampleRate, duration);

        let sumSq = 0;
        const stride = Math.max(1, Math.floor(samples.length / 12000));
        let count = 0;
        for (let i = 0; i < samples.length; i += stride) {
          sumSq += samples[i] * samples[i];
          count++;
        }
        const baselineRms = Math.sqrt(sumSq / Math.max(1, count));

        enrichedSegments = turns.map((turn, idx) => {
          const cleanText = applyGlossaryFixes(turn.text, customGlossary);
          const profile = extractVoiceProfile(samples, sampleRate, turn.start, turn.end);
          const tone = classifyVoiceTone(
            profile,
            cleanText,
            Math.max(0.4, turn.end - turn.start),
            baselineRms
          );
          const slangHits = slangPool.filter((term) => {
            if (!term) return false;
            const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`(^|[^a-záéíóúüñ])${escaped}([^a-záéíóúüñ]|$)`, 'i').test(
              cleanText.toLowerCase()
            );
          });

          return {
            id: `seg_${idx}`,
            start: turn.start,
            end: turn.end,
            timestamp: formatMMSS(turn.start),
            text: cleanText,
            voiceVector: profile.vector,
            tone,
            slangHits: Array.from(new Set(slangHits)),
          };
        });

        const autoSpeakers = clusterSpeakersByVoice(enrichedSegments, speakerMode);
        enrichedSegments.forEach((seg, idx) => {
          seg.speaker = autoSpeakers[idx];
        });

        smartNotes = generateSmartNotes(enrichedSegments, selectedRegion, customGlossary);
      }

      const completedSession = {
        ...draftSession,
        status: 'ready',
        engineLabel,
        duration: Number(duration.toFixed(2)),
        durationFormatted: formatMMSS(duration),
        segments: enrichedSegments,
        notes: smartNotes,
      };

      await saveSessionToVault(completedSession);
      setVaultSessions((prev) => [
        completedSession,
        ...prev.filter((x) => x.id !== completedSession.id),
      ]);
      setCurrentSession(completedSession);
      setIsProcessing(false);
      setActiveTab('dialogues');
      showToast('Transcripción y voces listas');
    } catch (err) {
      setIsProcessing(false);
      showToast(
        err?.message ||
          'Audio guardado en Bóveda. Conéctate la 1ra vez para descargar el motor IA.'
      );
    }
  };

  // Re-agrupar hablantes al instante sin volver a transcribir
  const handleChangeSpeakerMode = async (newMode) => {
    setSpeakerMode(newMode);
    if (!currentSession || !currentSession.segments?.length) return;
    const updatedLabels = clusterSpeakersByVoice(currentSession.segments, newMode);
    const updatedSegments = currentSession.segments.map((s, idx) => ({
      ...s,
      speaker: updatedLabels[idx],
    }));
    const updatedNotes = generateSmartNotes(
      updatedSegments,
      currentSession.region || selectedRegion,
      customGlossary
    );
    const updatedSession = {
      ...currentSession,
      speakerMode: newMode,
      segments: updatedSegments,
      notes: updatedNotes,
    };
    setCurrentSession(updatedSession);
    await saveSessionToVault(updatedSession).catch(() => {});
    setVaultSessions((prev) =>
      prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
    );
  };

  const getDisplaySpeakerName = (rawLabel) => {
    return currentSession?.speakerAliases?.[rawLabel] || rawLabel;
  };

  const saveSpeakerRename = async () => {
    if (!editingSpeaker || !currentSession) return;
    const trimmed = renameValue.trim();
    const nextAliases = { ...(currentSession.speakerAliases || {}) };
    if (trimmed) {
      nextAliases[editingSpeaker] = trimmed;
    } else {
      delete nextAliases[editingSpeaker];
    }
    const updated = { ...currentSession, speakerAliases: nextAliases };
    setCurrentSession(updated);
    setEditingSpeaker(null);
    setRenameValue('');
    await saveSessionToVault(updated).catch(() => {});
    setVaultSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const jumpToSecond = (sec) => {
    const player = audioPlayerRef.current;
    if (!player || !audioObjectUrl) return;
    player.currentTime = Math.max(0, sec || 0);
    player.play().catch(() => {});
    setIsPlayingAudio(true);
  };

  const toggleMasterAudio = () => {
    const player = audioPlayerRef.current;
    if (!player || !audioObjectUrl) return;
    if (player.paused) {
      player.play().catch(() => {});
      setIsPlayingAudio(true);
    } else {
      player.pause();
      setIsPlayingAudio(false);
    }
  };

  const buildPlainExportText = () => {
    if (!currentSession) return '';
    const lines = [
      `🎙️ VOXLATAM · ${currentSession.title}`,
      `🌎 Región: ${currentSession.region} | ⏱️ Duración: ${currentSession.durationFormatted}`,
      '',
      '📝 RESUMEN:',
      currentSession.notes?.summary || '',
      '',
      '💬 DIÁLOGOS:',
      ...(currentSession.segments || []).map(
        (s) =>
          `[${s.timestamp}] ${getDisplaySpeakerName(s.speaker)} (${s.tone?.label || 'Normal'}): ${s.text}`
      ),
    ];
    return lines.join('\n');
  };

  const handleCopyExport = async () => {
    const txt = buildPlainExportText();
    if (!txt) return;
    await navigator.clipboard?.writeText(txt).catch(() => {});
    showToast('Copiado al portapapeles');
  };

  const handleShareWhatsApp = async () => {
    const txt = buildPlainExportText();
    if (!txt) return;
    if (navigator.share) {
      await navigator.share({ title: currentSession.title, text: txt }).catch(() => {});
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank');
    }
  };

  const handleDownloadTxt = () => {
    const txt = buildPlainExportText();
    if (!txt) return;
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(currentSession?.title || 'voxlatam').replace(/\s+/g, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const addGlossaryWord = () => {
    const w = glossaryInput.trim();
    if (!w) return;
    if (!customGlossary.includes(w)) {
      setCustomGlossary([...customGlossary, w]);
    }
    setGlossaryInput('');
  };

  const uniqueSpeakers = useMemo(() => {
    if (!currentSession?.segments) return [];
    return Array.from(new Set(currentSession.segments.map((s) => s.speaker)));
  }, [currentSession]);

  const gradientStyle = {
    background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
  };

  const surfaceClass = isLight
    ? 'bg-white border-slate-200 text-slate-900 shadow-sm'
    : 'bg-[#0A0A0C] border-zinc-800/90 text-zinc-100';

  const mutedTextClass = isLight ? 'text-slate-500' : 'text-zinc-400';

  return (
    <div
      className={`min-h-screen flex flex-col select-none transition-colors duration-200 ${
        isLight ? 'bg-[#F8FAFC] text-slate-900' : 'bg-[#000000] text-white'
      }`}
    >
      {/* Audio oculto para reproducción sincronizada */}
      {audioObjectUrl && (
        <audio
          ref={audioPlayerRef}
          src={audioObjectUrl}
          onTimeUpdate={(e) => setPlaybackTime(e.currentTarget.currentTime)}
          onEnded={() => setIsPlayingAudio(false)}
        />
      )}

      {/* Barra Superior */}
      <header
        className={`sticky top-0 z-30 px-4 py-3.5 border-b backdrop-blur-md flex items-center justify-between ${
          isLight ? 'bg-white/90 border-slate-200' : 'bg-black/90 border-zinc-900'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center shadow-md"
            style={gradientStyle}
          >
            <Volume2 className="w-4 h-4 text-black stroke-[2.5]" />
          </div>
          <div>
            <span className="font-bold tracking-wider text-base">VOXLATAM</span>
            <span className={`block text-[10px] leading-none ${mutedTextClass}`}>
              {engineMode === 'hybrid' && geminiApiKey.trim()
                ? 'Gemini Flash · Híbrido'
                : 'IA Local · Offline'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowVaultModal(true)}
            className={`p-2 rounded-xl border transition ${surfaceClass}`}
            title="Bóveda de Grabaciones"
          >
            <FolderOpen className="w-4 h-4" style={{ color: primaryColor }} />
          </button>
          <button
            onClick={() => setShowThemeModal(true)}
            className={`p-2 rounded-xl border transition ${surfaceClass}`}
            title="Personalizar Colores y Tema"
          >
            <Palette className="w-4 h-4" style={{ color: primaryColor }} />
          </button>
          <button
            onClick={() => setShowEngineModal(true)}
            className={`p-2 rounded-xl border transition ${surfaceClass}`}
            title="Motor IA en el Teléfono"
          >
            <Cpu className="w-4 h-4" style={{ color: secondaryColor }} />
          </button>
        </div>
      </header>

      {/* Notificación flotante limpia */}
      {toastMessage && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full text-xs font-medium shadow-lg bg-zinc-900 text-white border border-zinc-700">
          {toastMessage}
        </div>
      )}

      {/* Contenido Principal */}
      <main className="flex-1 px-4 pt-4 pb-24 max-w-lg w-full mx-auto space-y-4">
        {/* PESTAÑA 1: GRABAR */}
        {activeTab === 'record' && (
          <div className="space-y-4">
            {engineMode === 'hybrid' && !geminiApiKey.trim() && (
              <div
                className={`rounded-2xl border p-3.5 flex items-center justify-between gap-3 ${surfaceClass}`}
                style={{ borderColor: `${primaryColor}60` }}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-black"
                    style={gradientStyle}
                  >
                    <Zap className="w-4 h-4 fill-current" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold truncate">
                      Activa Google AI Studio (98% precisión)
                    </div>
                    <div className={`text-[11px] truncate ${mutedTextClass}`}>
                      1 sola llamada por audio + respaldo automático
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setShowEngineModal(true)}
                  className="px-3 py-1.5 rounded-xl text-[11px] font-bold text-black shrink-0"
                  style={gradientStyle}
                >
                  Activar
                </button>
              </div>
            )}
            {/* Selector de acento regional y glosario */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-medium ${mutedTextClass}`}>
                  Acento y modismos regionales
                </span>
                <button
                  onClick={() => setShowGlossaryModal(true)}
                  className="text-xs font-semibold flex items-center gap-1 px-2.5 py-1 rounded-lg border border-current/25"
                  style={{ color: primaryColor }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Glosario ({customGlossary.length})
                </button>
              </div>

              <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                {REGIONS.map((reg) => {
                  const active = selectedRegion === reg.id;
                  return (
                    <button
                      key={reg.id}
                      onClick={() => setSelectedRegion(reg.id)}
                      className={`px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition flex items-center gap-1.5 ${
                        active
                          ? 'text-black font-semibold border-transparent shadow-sm'
                          : `${surfaceClass} opacity-80`
                      }`}
                      style={active ? gradientStyle : undefined}
                    >
                      <span>{reg.flag}</span>
                      <span>{reg.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tarjeta Principal de Grabación */}
            <div className={`rounded-3xl border p-6 text-center space-y-5 ${surfaceClass}`}>
              <div className="space-y-1">
                <div className="text-5xl font-mono font-bold tracking-tight">
                  {formatMMSS(recordSeconds)}
                </div>
                <p className={`text-xs ${mutedTextClass}`}>
                  {isRecording
                    ? isPaused
                      ? 'Grabación en pausa'
                      : 'Grabando voces en alta fidelidad...'
                    : 'Listo para grabar y separar hablantes automáticamente'}
                </p>
              </div>

              {/* Espectro de ondas en tiempo real */}
              <div className="h-14 flex items-center justify-center gap-1 px-2">
                {waveBars.map((h, i) => (
                  <div
                    key={i}
                    className="w-1.5 rounded-full transition-all duration-75"
                    style={{
                      height: `${isRecording && !isPaused ? h : 14}%`,
                      background: isRecording
                        ? `linear-gradient(to top, ${primaryColor}, ${secondaryColor})`
                        : isLight
                        ? '#CBD5E1'
                        : '#27272A',
                    }}
                  />
                ))}
              </div>

              {/* Controles de Micrófono */}
              <div className="flex items-center justify-center gap-5 py-2">
                {!isRecording ? (
                  <button
                    disabled={isProcessing}
                    onClick={startRecording}
                    className="w-24 h-24 rounded-full flex items-center justify-center shadow-xl active:scale-95 transition disabled:opacity-40"
                    style={{
                      ...gradientStyle,
                      boxShadow: `0 0 35px ${primaryColor}45`,
                    }}
                  >
                    <Mic className="w-10 h-10 text-black stroke-[2.3]" />
                  </button>
                ) : (
                  <>
                    <button
                      onClick={togglePauseRecording}
                      className={`w-14 h-14 rounded-full border flex items-center justify-center ${surfaceClass}`}
                    >
                      {isPaused ? (
                        <Play className="w-6 h-6" style={{ color: primaryColor }} />
                      ) : (
                        <Pause className="w-6 h-6 text-amber-400" />
                      )}
                    </button>
                    <button
                      onClick={stopRecording}
                      className="w-20 h-20 rounded-full bg-rose-500 text-white flex items-center justify-center shadow-lg active:scale-95 transition"
                    >
                      <Square className="w-8 h-8 fill-current" />
                    </button>
                  </>
                )}
              </div>

              {/* Selector rápido de cantidad de hablantes */}
              <div className="flex items-center justify-center gap-1.5 pt-1">
                <Users className={`w-3.5 h-3.5 ${mutedTextClass}`} />
                <span className={`text-xs ${mutedTextClass}`}>Hablantes:</span>
                {['auto', '1', '2', '3', '4'].map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setSpeakerMode(mode)}
                    className={`px-2.5 py-0.5 rounded-md text-xs font-medium border transition ${
                      speakerMode === mode
                        ? 'text-black border-transparent font-semibold'
                        : isLight
                        ? 'border-slate-200 text-slate-600'
                        : 'border-zinc-800 text-zinc-400'
                    }`}
                    style={speakerMode === mode ? gradientStyle : undefined}
                  >
                    {mode === 'auto' ? 'Auto' : mode}
                  </button>
                ))}
              </div>

              {/* Importar archivo de audio */}
              <div className="pt-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,.mp3,.m4a,.wav,.ogg,.opus,.aac,.webm"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  disabled={isRecording || isProcessing}
                  onClick={() => fileInputRef.current?.click()}
                  className={`w-full py-3.5 px-4 rounded-2xl border flex items-center justify-center gap-2.5 text-xs font-medium transition active:scale-[0.99] disabled:opacity-40 ${
                    isLight
                      ? 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                      : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <Upload className="w-4 h-4" style={{ color: primaryColor }} />
                  <span>Importar archivo de audio (MP3, M4A, WAV, OGG, WhatsApp)</span>
                </button>
              </div>
            </div>

            {/* Barra de progreso elegante (sin errores rojos de cuota) */}
            {isProcessing && (
              <div className={`rounded-2xl border p-4 space-y-2.5 ${surfaceClass}`}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium flex items-center gap-2">
                    <Sparkles className="w-4 h-4 animate-spin" style={{ color: primaryColor }} />
                    {processMessage}
                  </span>
                  <span className="font-mono font-semibold">{processProgress}%</span>
                </div>
                <div
                  className={`w-full h-2 rounded-full overflow-hidden ${
                    isLight ? 'bg-slate-200' : 'bg-zinc-900'
                  }`}
                >
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${processProgress}%`, ...gradientStyle }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* PESTAÑA 2: DIÁLOGOS */}
        {activeTab === 'dialogues' && (
          <div className="space-y-4">
            {!currentSession || !currentSession.segments?.length ? (
              <div className={`rounded-3xl border p-8 text-center space-y-3 ${surfaceClass}`}>
                <MessageSquare
                  className="w-10 h-10 mx-auto opacity-60"
                  style={{ color: primaryColor }}
                />
                <h3 className="font-semibold text-sm">Aún no hay diálogos procesados</h3>
                <p className={`text-xs ${mutedTextClass}`}>
                  Graba una conversación o importa un audio en la pestaña Grabar para separar
                  automáticamente Hablante 1, Hablante 2 y sus tonos de voz.
                </p>
              </div>
            ) : (
              <>
                {/* Barra reproductora con línea de tiempo multicolor por hablante */}
                <div className={`rounded-2xl border p-4 space-y-3 ${surfaceClass}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate">
                      <h3 className="text-sm font-bold truncate">{currentSession.title}</h3>
                      <p className={`text-[11px] ${mutedTextClass}`}>
                        {currentSession.region} · {uniqueSpeakers.length} hablante(s) ·{' '}
                        {currentSession.durationFormatted}
                        {currentSession.engineLabel ? ` · ${currentSession.engineLabel}` : ''}
                      </p>
                    </div>
                    {audioObjectUrl && (
                      <button
                        onClick={toggleMasterAudio}
                        className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-black shadow"
                        style={gradientStyle}
                      >
                        {isPlayingAudio ? (
                          <Pause className="w-4 h-4 fill-current" />
                        ) : (
                          <Play className="w-4 h-4 fill-current ml-0.5" />
                        )}
                      </button>
                    )}
                  </div>

                  {/* Línea visual de intervenciones */}
                  <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-zinc-900/50 gap-0.5">
                    {currentSession.segments.map((seg) => {
                      const widthPct = Math.max(
                        2,
                        ((seg.end - seg.start) / Math.max(1, currentSession.duration)) * 100
                      );
                      return (
                        <div
                          key={seg.id}
                          onClick={() => jumpToSecond(seg.start)}
                          className="h-full cursor-pointer opacity-90 hover:opacity-100"
                          style={{
                            width: `${widthPct}%`,
                            backgroundColor: getSpeakerColor(seg.speaker),
                          }}
                          title={`${getDisplaySpeakerName(seg.speaker)} (${seg.timestamp})`}
                        />
                      );
                    })}
                  </div>

                  {/* Ajuste instantáneo de separación de hablantes */}
                  <div className="flex items-center justify-between pt-1 text-xs">
                    <span className={mutedTextClass}>Separación de voces:</span>
                    <div className="flex gap-1">
                      {['auto', '1', '2', '3', '4'].map((m) => (
                        <button
                          key={m}
                          onClick={() => handleChangeSpeakerMode(m)}
                          className={`px-2 py-0.5 rounded text-[11px] border ${
                            (currentSession.speakerMode || speakerMode) === m
                              ? 'text-black font-bold border-transparent'
                              : isLight
                              ? 'border-slate-200 text-slate-600'
                              : 'border-zinc-800 text-zinc-400'
                          }`}
                          style={
                            (currentSession.speakerMode || speakerMode) === m
                              ? gradientStyle
                              : undefined
                          }
                        >
                          {m === 'auto' ? 'Auto' : m}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Lista tipo Chat Inteligente */}
                <div className="space-y-3">
                  {currentSession.segments.map((seg) => {
                    const spkColor = getSpeakerColor(seg.speaker);
                    const isCurrentSecond =
                      isPlayingAudio && playbackTime >= seg.start && playbackTime <= seg.end;

                    return (
                      <div
                        key={seg.id}
                        onClick={() => jumpToSecond(seg.start)}
                        className={`rounded-2xl border p-3.5 transition cursor-pointer ${surfaceClass}`}
                        style={
                          isCurrentSecond
                            ? { borderColor: spkColor, boxShadow: `0 0 0 1px ${spkColor}` }
                            : undefined
                        }
                      >
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: spkColor }}
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingSpeaker(seg.speaker);
                                setRenameValue(getDisplaySpeakerName(seg.speaker));
                              }}
                              className="text-xs font-bold flex items-center gap-1 hover:underline"
                              style={{ color: spkColor }}
                            >
                              {getDisplaySpeakerName(seg.speaker)}
                              <Edit3 className="w-3 h-3 opacity-60" />
                            </button>
                            <span className={`text-[11px] font-mono ${mutedTextClass}`}>
                              {seg.timestamp}
                            </span>
                          </div>

                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full border ${
                              isLight
                                ? 'bg-slate-100 border-slate-200 text-slate-700'
                                : 'bg-zinc-900 border-zinc-800 text-zinc-300'
                            }`}
                          >
                            {seg.tone?.badge || '😌 Tono calmado'}
                          </span>
                        </div>

                        <p className="text-sm leading-relaxed">{seg.text}</p>

                        {seg.slangHits?.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {seg.slangHits.map((sl) => (
                              <span
                                key={sl}
                                className="text-[10px] px-2 py-0.5 rounded-md font-medium"
                                style={{
                                  backgroundColor: `${primaryColor}20`,
                                  color: primaryColor,
                                }}
                              >
                                #{sl}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* PESTAÑA 3: NOTAS */}
        {activeTab === 'notes' && (
          <div className="space-y-4">
            {!currentSession || !currentSession.segments?.length ? (
              <div className={`rounded-3xl border p-8 text-center space-y-3 ${surfaceClass}`}>
                <FileText
                  className="w-10 h-10 mx-auto opacity-60"
                  style={{ color: primaryColor }}
                />
                <h3 className="font-semibold text-sm">Sin notas generadas todavía</h3>
                <p className={`text-xs ${mutedTextClass}`}>
                  Al procesar cualquier audio tendrás aquí el resumen ejecutivo, el porcentaje de
                  participación por voz y exportación directa a WhatsApp.
                </p>
              </div>
            ) : (
              <>
                {/* Acciones rápidas de compartir */}
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={handleCopyExport}
                    className={`py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 ${surfaceClass}`}
                  >
                    <Copy className="w-3.5 h-3.5" style={{ color: primaryColor }} />
                    Copiar
                  </button>
                  <button
                    onClick={handleShareWhatsApp}
                    className="py-2.5 px-3 rounded-xl text-xs font-bold text-black flex items-center justify-center gap-1.5 shadow"
                    style={gradientStyle}
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    Compartir
                  </button>
                  <button
                    onClick={handleDownloadTxt}
                    className={`py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 ${surfaceClass}`}
                  >
                    <Download className="w-3.5 h-3.5" style={{ color: secondaryColor }} />
                    TXT
                  </button>
                </div>

                {/* Resumen Ejecutivo */}
                <div className={`rounded-2xl border p-4 space-y-2 ${surfaceClass}`}>
                  <h4
                    className="text-xs font-bold uppercase tracking-wider"
                    style={{ color: primaryColor }}
                  >
                    Resumen de la Conversación
                  </h4>
                  <p className="text-sm leading-relaxed">{currentSession.notes?.summary}</p>
                </div>

                {/* Participación por Hablante */}
                {currentSession.notes?.speakerStats && (
                  <div className={`rounded-2xl border p-4 space-y-3 ${surfaceClass}`}>
                    <h4 className="text-xs font-bold uppercase tracking-wider">
                      Participación por Voz
                    </h4>
                    {Object.entries(currentSession.notes.speakerStats).map(([spk, pct]) => (
                      <div key={spk} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="font-semibold">{getDisplaySpeakerName(spk)}</span>
                          <span className="font-mono">{pct}%</span>
                        </div>
                        <div
                          className={`h-2 rounded-full overflow-hidden ${
                            isLight ? 'bg-slate-200' : 'bg-zinc-900'
                          }`}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: getSpeakerColor(spk),
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Intervenciones Destacadas */}
                {currentSession.notes?.highlights?.length > 0 && (
                  <div className={`rounded-2xl border p-4 space-y-2.5 ${surfaceClass}`}>
                    <h4 className="text-xs font-bold uppercase tracking-wider">
                      Momentos Clave (Toca para escuchar)
                    </h4>
                    {currentSession.notes.highlights.map((hl, i) => (
                      <div
                        key={i}
                        onClick={() => {
                          setActiveTab('dialogues');
                          setTimeout(() => jumpToSecond(hl.start), 120);
                        }}
                        className={`p-3 rounded-xl border text-xs space-y-1 cursor-pointer ${
                          isLight
                            ? 'bg-slate-50 border-slate-200'
                            : 'bg-zinc-950 border-zinc-800/80'
                        }`}
                      >
                        <div className="flex justify-between font-semibold">
                          <span style={{ color: getSpeakerColor(hl.speaker) }}>
                            {getDisplaySpeakerName(hl.speaker)} · {hl.timestamp}
                          </span>
                          <span>{hl.toneBadge}</span>
                        </div>
                        <p className={mutedTextClass}>{hl.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>

      {/* Navegación Inferior (Solo 3 pestañas: Grabar, Diálogos, Notas) */}
      <nav
        className={`fixed bottom-0 inset-x-0 z-30 border-t px-6 py-2 backdrop-blur-md ${
          isLight ? 'bg-white/95 border-slate-200' : 'bg-black/95 border-zinc-900'
        }`}
      >
        <div className="max-w-lg mx-auto grid grid-cols-3 gap-2">
          {[
            { id: 'record', label: 'Grabar', icon: Mic },
            { id: 'dialogues', label: 'Diálogos', icon: MessageSquare },
            { id: 'notes', label: 'Notas', icon: FileText },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex flex-col items-center gap-1 py-1"
              >
                <div
                  className="px-4 py-1 rounded-full transition"
                  style={active ? { backgroundColor: `${primaryColor}25` } : undefined}
                >
                  <Icon
                    className="w-5 h-5"
                    style={{ color: active ? primaryColor : isLight ? '#64748B' : '#71717A' }}
                  />
                </div>
                <span
                  className="text-[11px] font-medium"
                  style={{ color: active ? primaryColor : isLight ? '#64748B' : '#71717A' }}
                >
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* MODAL: Personalizador de Tema (Negro AMOLED / Modo Claro / Colores Libres) */}
      {showThemeModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className={`w-full max-w-md rounded-3xl border p-5 space-y-4 ${surfaceClass}`}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base">Apariencia y Colores</h3>
              <button onClick={() => setShowThemeModal(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Selector Negro AMOLED vs Modo Claro */}
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => setThemeMode('amoled')}
                className={`p-3 rounded-2xl border flex items-center justify-center gap-2 text-xs font-semibold ${
                  !isLight ? 'border-emerald-500 bg-zinc-900 text-white' : 'border-slate-200'
                }`}
              >
                <Moon className="w-4 h-4" />
                Negro AMOLED
              </button>
              <button
                onClick={() => setThemeMode('light')}
                className={`p-3 rounded-2xl border flex items-center justify-center gap-2 text-xs font-semibold ${
                  isLight ? 'border-emerald-500 bg-slate-100 text-slate-900' : 'border-zinc-800'
                }`}
              >
                <Sun className="w-4 h-4" />
                Modo Claro
              </button>
            </div>

            {/* Combinaciones rápidas */}
            <div className="space-y-2">
              <span className={`text-xs ${mutedTextClass}`}>Estilos rápidos</span>
              <div className="flex gap-2.5 flex-wrap">
                {COLOR_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => {
                      setPrimaryColor(preset.primary);
                      setSecondaryColor(preset.secondary);
                    }}
                    className="px-3 py-1.5 rounded-full text-xs font-semibold text-black flex items-center gap-1.5"
                    style={{
                      background: `linear-gradient(135deg, ${preset.primary}, ${preset.secondary})`,
                    }}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Selector de color libre (cualquier color que quieras) */}
            <div className="space-y-2 pt-1">
              <span className={`text-xs ${mutedTextClass}`}>
                Elige tus propios colores a tu gusto
              </span>
              <div className="grid grid-cols-2 gap-3">
                <label
                  className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer ${
                    isLight ? 'border-slate-200' : 'border-zinc-800'
                  }`}
                >
                  <span className="text-xs font-medium">Color Principal</span>
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="w-8 h-8 rounded cursor-pointer bg-transparent border-0"
                  />
                </label>
                <label
                  className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer ${
                    isLight ? 'border-slate-200' : 'border-zinc-800'
                  }`}
                >
                  <span className="text-xs font-medium">Degradado</span>
                  <input
                    type="color"
                    value={secondaryColor}
                    onChange={(e) => setSecondaryColor(e.target.value)}
                    className="w-8 h-8 rounded cursor-pointer bg-transparent border-0"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Motor IA Híbrido (Whisper Large-v3 Gratis + Respaldo Offline) */}
      {showEngineModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div
            className={`w-full max-w-md max-h-[88vh] overflow-y-auto rounded-3xl border p-5 space-y-4 ${surfaceClass}`}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base">Motor de Transcripción IA</h3>
              <button onClick={() => setShowEngineModal(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Selector de Modo */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setEngineMode('hybrid')}
                className={`p-3 rounded-2xl border flex items-center justify-center gap-1.5 text-xs font-bold transition ${
                  engineMode === 'hybrid'
                    ? 'text-black border-transparent'
                    : isLight
                    ? 'border-slate-200 text-slate-700'
                    : 'border-zinc-800 text-zinc-300'
                }`}
                style={engineMode === 'hybrid' ? gradientStyle : undefined}
              >
                <Zap className="w-4 h-4" />
                Híbrido (98%)
              </button>
              <button
                onClick={() => setEngineMode('offline')}
                className={`p-3 rounded-2xl border flex items-center justify-center gap-1.5 text-xs font-bold transition ${
                  engineMode === 'offline'
                    ? 'text-black border-transparent'
                    : isLight
                    ? 'border-slate-200 text-slate-700'
                    : 'border-zinc-800 text-zinc-300'
                }`}
                style={engineMode === 'offline' ? gradientStyle : undefined}
              >
                <WifiOff className="w-4 h-4" />
                Solo Offline
              </button>
            </div>

            {engineMode === 'hybrid' && (
              <div
                className={`p-3.5 rounded-2xl border space-y-3 ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-zinc-950 border-zinc-800'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5" style={{ color: primaryColor }} />
                    API Key de Google AI Studio
                  </span>
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-semibold flex items-center gap-1 underline"
                    style={{ color: primaryColor }}
                  >
                    Ver mi clave
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showKeyText ? 'text' : 'password'}
                      value={geminiApiKey}
                      onChange={(e) => {
                        setGeminiApiKey(e.target.value);
                        setGeminiTestStatus(null);
                      }}
                      placeholder="Pega aquí tu clave AIza..."
                      className={`w-full pl-3 pr-9 py-2 rounded-xl border text-xs bg-transparent outline-none font-mono ${
                        isLight ? 'border-slate-300' : 'border-zinc-700'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowKeyText((v) => !v)}
                      className={`absolute right-2.5 top-1/2 -translate-y-1/2 ${mutedTextClass}`}
                    >
                      {showKeyText ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={testingGemini}
                    onClick={async () => {
                      setTestingGemini(true);
                      const res = await testGeminiConnection(geminiApiKey);
                      setGeminiTestStatus(res);
                      setTestingGemini(false);
                    }}
                    className="px-3 py-2 rounded-xl text-xs font-bold text-black shrink-0 disabled:opacity-50"
                    style={gradientStyle}
                  >
                    {testingGemini ? '...' : 'Probar'}
                  </button>
                </div>

                {geminiTestStatus && (
                  <p
                    className={`text-[11px] font-medium ${
                      geminiTestStatus.ok ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {geminiTestStatus.ok ? '✓ ' : '✕ '}
                    {geminiTestStatus.message}
                  </p>
                )}

                <div className="space-y-1.5 pt-1">
                  <span className={`text-[11px] font-semibold ${mutedTextClass}`}>
                    Estrategia de modelos (1 sola llamada por audio):
                  </span>
                  {GEMINI_MODELS.map((gm) => {
                    const selected = geminiModel === gm.id;
                    return (
                      <button
                        key={gm.id}
                        onClick={() => setGeminiModel(gm.id)}
                        className={`w-full text-left p-2.5 rounded-xl border transition ${
                          selected
                            ? 'border-current'
                            : isLight
                            ? 'border-slate-200'
                            : 'border-zinc-800'
                        }`}
                        style={selected ? { borderColor: primaryColor } : undefined}
                      >
                        <div className="flex items-center justify-between text-xs font-bold">
                          <span>{gm.name}</span>
                          <span className="text-[10px]" style={{ color: primaryColor }}>
                            {gm.tag}
                          </span>
                        </div>
                        <p className={`text-[11px] mt-0.5 ${mutedTextClass}`}>{gm.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Respaldo Offline */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold">
                  {engineMode === 'hybrid'
                    ? 'Respaldo automático si estás sin señal:'
                    : 'Modelo Offline (en tu teléfono):'}
                </span>
              </div>
              {MODELS.map((m) => {
                const selected = modelId === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setModelId(m.id)}
                    className={`w-full text-left p-2.5 rounded-2xl border transition ${
                      selected ? 'border-current' : isLight ? 'border-slate-200' : 'border-zinc-800'
                    }`}
                    style={selected ? { borderColor: secondaryColor } : undefined}
                  >
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span>{m.name}</span>
                      <span style={{ color: secondaryColor }}>{m.size}</span>
                    </div>
                    <p className={`text-[11px] mt-0.5 ${mutedTextClass}`}>{m.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Glosario Personalizado */}
      {showGlossaryModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className={`w-full max-w-md rounded-3xl border p-5 space-y-4 ${surfaceClass}`}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base">Glosario Personalizado</h3>
              <button onClick={() => setShowGlossaryModal(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className={`text-xs ${mutedTextClass}`}>
              Añade nombres propios, empresas o jerga local para resaltarlos y cuidarlos en tus
              transcripciones.
            </p>
            <div className="flex gap-2">
              <input
                value={glossaryInput}
                onChange={(e) => setGlossaryInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addGlossaryWord()}
                placeholder="Ej: Maracaibo, Banesco, chamo..."
                className={`flex-1 px-3 py-2 rounded-xl border text-xs bg-transparent outline-none ${
                  isLight ? 'border-slate-300' : 'border-zinc-700'
                }`}
              />
              <button
                onClick={addGlossaryWord}
                className="px-4 py-2 rounded-xl text-xs font-bold text-black"
                style={gradientStyle}
              >
                Añadir
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
              {customGlossary.map((w) => (
                <span
                  key={w}
                  className={`px-2.5 py-1 rounded-full text-xs border flex items-center gap-1.5 ${
                    isLight ? 'border-slate-200 bg-slate-100' : 'border-zinc-800 bg-zinc-900'
                  }`}
                >
                  {w}
                  <button
                    onClick={() => setCustomGlossary(customGlossary.filter((x) => x !== w))}
                    className="opacity-60 hover:opacity-100"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Bóveda de Grabaciones Guardadas */}
      {showVaultModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className={`w-full max-w-md rounded-3xl border p-5 space-y-4 ${surfaceClass}`}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base">Bóveda en tu Teléfono ({vaultSessions.length})</h3>
              <button onClick={() => setShowVaultModal(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            {vaultSessions.length === 0 ? (
              <p className={`text-xs py-6 text-center ${mutedTextClass}`}>
                Todavía no tienes grabaciones guardadas.
              </p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {vaultSessions.map((sess) => (
                  <div
                    key={sess.id}
                    className={`p-3 rounded-2xl border flex items-center justify-between gap-2 ${
                      currentSession?.id === sess.id ? 'border-current' : 'border-zinc-800/60'
                    }`}
                    style={
                      currentSession?.id === sess.id ? { borderColor: primaryColor } : undefined
                    }
                  >
                    <div
                      onClick={() => {
                        setCurrentSession(sess);
                        setShowVaultModal(false);
                        if (sess.status === 'ready') setActiveTab('dialogues');
                      }}
                      className="flex-1 cursor-pointer truncate"
                    >
                      <div className="text-xs font-bold truncate">{sess.title}</div>
                      <div className={`text-[11px] ${mutedTextClass}`}>
                        {sess.region} · {sess.durationFormatted} ·{' '}
                        {sess.status === 'ready' ? 'Listo' : 'Pendiente'}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {sess.audioBlob && (
                        <button
                          onClick={() => {
                            setShowVaultModal(false);
                            processAudioBlob(sess.audioBlob, sess.title);
                          }}
                          className="p-1.5 rounded-lg text-black"
                          style={gradientStyle}
                          title="Transcribir o reprocesar ahora"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={async () => {
                          await deleteVaultSession(sess.id).catch(() => {});
                          const next = vaultSessions.filter((x) => x.id !== sess.id);
                          setVaultSessions(next);
                          if (currentSession?.id === sess.id) {
                            setCurrentSession(next[0] || null);
                          }
                        }}
                        className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: Renombrar Hablante (opcional) */}
      {editingSpeaker && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className={`w-full max-w-xs rounded-3xl border p-5 space-y-4 ${surfaceClass}`}>
            <h3 className="font-bold text-sm">Cambiar nombre de {editingSpeaker}</h3>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveSpeakerRename()}
              placeholder={editingSpeaker}
              className={`w-full px-3 py-2 rounded-xl border text-sm bg-transparent outline-none ${
                isLight ? 'border-slate-300' : 'border-zinc-700'
              }`}
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEditingSpeaker(null)}
                className={`px-3 py-1.5 rounded-xl text-xs ${mutedTextClass}`}
              >
                Cancelar
              </button>
              <button
                onClick={saveSpeakerRename}
                className="px-4 py-1.5 rounded-xl text-xs font-bold text-black flex items-center gap-1"
                style={gradientStyle}
              >
                <Check className="w-3.5 h-3.5" />
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
