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
  const { id, type, audioSamples, modelId = 'Xenova/whisper-base' } = event.data;

  if (type === 'TRANSCRIBE') {
    try {
      self.postMessage({
        id,
        status: 'loading_model',
        progress: 8,
        message: 'Inicializando motor neuronal en tu teléfono...',
      });

      const transcriber = await ensurePipeline(modelId, (prog) => {
        if (prog.status === 'progress' && typeof prog.progress === 'number') {
          const pct = Math.max(5, Math.min(99, Math.round(prog.progress)));
          self.postMessage({
            id,
            status: 'downloading',
            progress: pct,
            message: `Guardando motor IA en memoria (${pct}%) · Solo la 1ra vez`,
          });
        } else if (prog.status === 'ready') {
          self.postMessage({
            id,
            status: 'transcribing',
            progress: 100,
            message: 'Transcribiendo voces y modismos en español...',
          });
        }
      });

      self.postMessage({
        id,
        status: 'transcribing',
        progress: 100,
        message: 'Reconociendo palabras y marcas de tiempo...',
      });

      const output = await transcriber(audioSamples, {
        language: 'spanish',
        task: 'transcribe',
        chunk_length_s: 28,
        stride_length_s: 5,
        return_timestamps: true,
      });

      self.postMessage({
        id,
        status: 'done',
        result: output,
      });
    } catch (err) {
      self.postMessage({
        id,
        status: 'error',
        error:
          err?.message ||
          'No se pudo inicializar el modelo. Verifica tener conexión la primera vez para guardarlo en el teléfono.',
      });
    }
  }
};
