import { pipeline, env } from '@xenova/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
}

let loadedModelId = null;
let asrPipeline = null;

async function ensurePipeline(modelId, reportProgress) {
  if (asrPipeline && loadedModelId === modelId) {
    return asrPipeline;
  }
  loadedModelId = modelId;
  asrPipeline = await pipeline('automatic-speech-recognition', modelId, {
    quantized: true,
    progress_callback: (data) => {
      if (reportProgress) reportProgress(data);
    },
  });
  return asrPipeline;
}

self.onmessage = async (event) => {
  const { id, type, audioSamples, duration = 0, modelId = 'Xenova/whisper-small' } = event.data;

  if (type === 'TRANSCRIBE') {
    try {
      self.postMessage({
        id,
        status: 'loading_model',
        progress: 12,
        message: 'Inicializando motor offline en tu teléfono...',
      });

      const transcriber = await ensurePipeline(modelId, (prog) => {
        if (prog.status === 'progress' && typeof prog.progress === 'number') {
          const pct = Math.max(10, Math.min(99, Math.round(prog.progress)));
          self.postMessage({
            id,
            status: 'downloading',
            progress: pct,
            message: `Guardando motor offline (${pct}%) · Solo la 1ra vez`,
          });
        } else if (prog.status === 'ready') {
          self.postMessage({
            id,
            status: 'transcribing',
            progress: 86,
            message: 'Transcribiendo en modo offline...',
          });
        }
      });

      self.postMessage({
        id,
        status: 'transcribing',
        progress: 88,
        message: 'Reconociendo palabras en español (modo offline)...',
      });

      // Evitar cortes chunk_length_s en audios cortos (<=28s) para no dañar la precisión en español
      const options = {
        language: 'spanish',
        task: 'transcribe',
        return_timestamps: true,
        no_repeat_ngram_size: 3,
        repetition_penalty: 1.15,
        condition_on_previous_text: false,
      };

      if (duration > 28) {
        options.chunk_length_s = 28;
        options.stride_length_s = 5;
      }

      const output = await transcriber(audioSamples, options);

      self.postMessage({
        id,
        status: 'done',
        result: {
          ...output,
          engineLabel: '📱 Offline Local',
        },
      });
    } catch (err) {
      self.postMessage({
        id,
        status: 'error',
        error:
          err?.message ||
          'No se pudo ejecutar el motor offline. Verifica tu conexión para descargarlo la primera vez.',
      });
    }
  }
};
