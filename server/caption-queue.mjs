// Fila em memória de legendas (Whisper) com concorrência limitada.
import { randomUUID } from 'node:crypto';
import { transcribe } from './whisper.mjs';

export function createCaptionQueue({ concurrency = 1, worker = transcribe } = {}) {
  const jobs = new Map();
  const fila = [];
  let ativos = 0;

  function pump() {
    while (ativos < concurrency && fila.length) {
      const job = jobs.get(fila.shift());
      ativos++;
      job.status = 'processing';
      worker(job.file, job.lang)
        .then((r) => { job.status = 'done'; job.result = r; })
        .catch((e) => { job.status = 'error'; job.error = String(e.message || e); })
        .finally(() => { ativos--; pump(); });
    }
  }

  return {
    enqueue(file, lang = 'pt') {
      const id = randomUUID();
      jobs.set(id, { id, file, lang, status: 'queued' });
      fila.push(id);
      pump();
      return id;
    },
    get: (id) => jobs.get(id) || null,
    size: () => fila.length,
  };
}
