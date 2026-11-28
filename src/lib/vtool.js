// ============================================================
// Peças de UI compartilhadas pelas tools de vídeo
// ============================================================
import { VIDEO_LIMITS } from './video.js';

/** Detecta tipo por MIME primeiro, extensão como fallback */
export const isVideoFile = (f) => /^video\//.test(f.type || '') || /\.(mp4|mov|webm|m4v|mkv|avi)$/i.test(f.name || '');
export const isImageFile = (f) => /^image\//.test(f.type || '') || /\.(jpe?g|png|webp|gif|avif)$/i.test(f.name || '');
export const isAudioFile = (f) => /^audio\//.test(f.type || '') || /\.(mp3|wav|m4a|ogg|aac|flac)$/i.test(f.name || '');

/** Valida um arquivo de vídeo contra os limites (null = ok, string = erro) */
export function checkVideo(file) {
  if (!isVideoFile(file)) return 'Escolha um vídeo (MP4, MOV ou WebM)';
  if (file.size > VIDEO_LIMITS.bytes) return `Máximo ${Math.round(VIDEO_LIMITS.bytes / 1048576)} MB por arquivo`;
  return null;
}

/** Liga dropzone + input file → onFiles(File[]) */
export function bindDrop(root, dropEl, inputEl, onFiles) {
  inputEl.onclick = (e) => e.stopPropagation();
  dropEl.onclick = () => inputEl.click();
  dropEl.ondragover = (e) => { e.preventDefault(); dropEl.classList.add('over'); };
  dropEl.ondragleave = () => dropEl.classList.remove('over');
  dropEl.ondrop = (e) => { e.preventDefault(); dropEl.classList.remove('over'); if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); };
  inputEl.onchange = () => { if (inputEl.files.length) onFiles([...inputEl.files]); inputEl.value = ''; };
}

/** Linha de status do arquivo carregado */
export function fileLine(name, detail) {
  return `<div class="fileline">📎 <b></b><span class="fdet"></span></div>`
    .replace('<b>', `<b>${name}</b>`)
    .replace('<span class="fdet">', `<span class="fdet">${detail || ''}</span>`);
}

/** Nome de saída: base do arquivo sem extensão + sufixo */
export function outName(file, suffix) {
  const base = (file.name || 'video').replace(/\.[^.]+$/, '');
  return `${base}${suffix}`;
}
