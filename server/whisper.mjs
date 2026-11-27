// Transcrição Whisper server-side. Provedor definido por env (decisão de custo pendente):
//   WHISPER_PROVIDER=openai  -> API OpenAI (WHISPER_API_KEY)
//   WHISPER_PROVIDER=local   -> binário whisper.cpp na VPS (WHISPER_BIN, WHISPER_MODEL)
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

export function toSrt(segments) {
  const ts = (s) => {
    const ms = Math.round(s * 1000);
    const p = (n, l = 2) => String(n).padStart(l, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  return segments.map((g, i) => `${i + 1}\n${ts(g.start)} --> ${ts(g.end)}\n${g.text.trim()}\n`).join('\n');
}

async function viaOpenAI(file, lang) {
  const key = process.env.WHISPER_API_KEY;
  if (!key) throw new Error('WHISPER_API_KEY ausente');
  const fd = new FormData();
  fd.append('file', new Blob([await readFile(file)]), 'audio');
  fd.append('model', 'whisper-1');
  fd.append('response_format', 'verbose_json');
  if (lang) fd.append('language', lang);
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd,
  });
  if (!r.ok) throw new Error(`Whisper API ${r.status}`);
  return (await r.json()).segments || [];
}

async function viaLocal(file, lang) {
  const bin = process.env.WHISPER_BIN || 'whisper-cli';
  const { stdout } = await run(bin, ['-m', process.env.WHISPER_MODEL || 'models/ggml-base.bin', '-f', file, '-l', lang || 'pt', '-oj', '-of', '/dev/stdout']);
  return (JSON.parse(stdout).transcription || []).map((t) => ({
    start: t.offsets.from / 1000, end: t.offsets.to / 1000, text: t.text,
  }));
}

export async function transcribe(file, lang = 'pt') {
  const segs = process.env.WHISPER_PROVIDER === 'local' ? await viaLocal(file, lang) : await viaOpenAI(file, lang);
  return { segments: segs, srt: toSrt(segs) };
}
