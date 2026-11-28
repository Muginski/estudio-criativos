// ============================================================
// Engine de vídeo 100% no navegador (canvas + captureStream + MediaRecorder + WebAudio)
// Um único pipeline; cada tool é só um config dele:
//   - cortar        → { start, end }
//   - converter     → { w, h, fit, bg }            (9:16 ↔ 3:4)
//   - cloaker       → { overlay: {img, fadeAt, fadeDur, finalOp}, extendSec, perturb }
//   - previa        → { censor: {mode, region, untilSec} }
//   - comprimir     → { bitrate }                   (+ comparação de tamanho)
//   - marca d'água  → { wm: {text,pos,sizePct,...} }
//   - legendas      → { captions: [{start,end,text}] }
//   - cloaker áudio → { overlayAudioFile, volOriginal, volOverlay }
//   - limpar        → re-encode puro (metadados saem sozinhos)
// Diferencial vs Rateio Hot: eles mandam o arquivo pro servidor (TTL 24h);
// aqui nada sai do aparelho.
// ============================================================
import { drawCover, drawContained } from './canvas.js';

export const VIDEO_LIMITS = { files: 5, bytes: 33 * 1024 * 1024, sec: 180 };

const once = (el, ev) => new Promise((ok, fail) => {
  el.addEventListener(ev, ok, { once: true });
  el.addEventListener('error', () => fail(new Error('Não foi possível ler o arquivo')), { once: true });
});

/** Codec preferido: MP4(H.264) se o navegador der conta, senão VP9/VP8 */
export function pickCodec(preferMp4 = true) {
  const cands = preferMp4
    ? ['video/mp4;codecs="avc1.42E01E"', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  for (const c of cands) { try { if (MediaRecorder.isTypeSupported(c)) return c; } catch { /* segue */ } }
  return '';
}
export const codecExt = (mime) => /mp4/i.test(mime) ? 'mp4' : 'webm';

/** Dimensões alvo: formatos padrão de anúncio; resto escala com máx 1440 no maior lado */
export function targetSize(srcW, srcH, o = {}) {
  if (o.w && o.h) return { w: o.w & ~1, h: o.h & ~1 };
  const ar = srcW / srcH;
  let tw, th;
  if (ar >= 1) { tw = 1440; th = Math.round(tw / ar); }          // paisagem
  else if (Math.abs(ar - 9 / 16) < 0.03) { th = 1920; tw = Math.round(th * ar); } // stories/reels
  else { th = 1440; tw = Math.round(th * ar); }                  // feed/portrait (≈3:4)
  return { w: tw & ~1, h: th & ~1 };
}

/** Metadados rápidos sem carregar frames */
export async function probeVideo(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.preload = 'metadata'; v.muted = true; v.src = url;
  await once(v, 'loadedmetadata');
  const info = { w: v.videoWidth, h: v.videoHeight, dur: v.duration || 0 };
  v.removeAttribute('src');
  URL.revokeObjectURL(url);
  return info;
}

// ---------- cenas (desenho por frame) ----------
let _scratch = null, _small = null, _noiseCv = null;
// canvases são criados sob demanda: mantém o módulo importável em Node (testes)
function scratchCv() { if (!_scratch) _scratch = document.createElement('canvas'); return _scratch; }
function smallCv() { if (!_small) _small = document.createElement('canvas'); return _small; }
function noiseCv() { if (!_noiseCv) { _noiseCv = document.createElement('canvas'); _noiseCv.width = 192; _noiseCv.height = 108; } return _noiseCv; }
let noiseTick = 0;
function refreshNoise() {
  const cv = noiseCv();
  const id = cv.getContext('2d').createImageData(192, 108);
  for (let i = 0; i < id.data.length; i += 4) {
    const g = (Math.random() * 255) | 0;
    id.data[i] = id.data[i + 1] = id.data[i + 2] = g; id.data[i + 3] = 255;
  }
  cv.getContext('2d').putImageData(id, 0, 0);
}

function overlayOpacity(ov, tRel, frozen) {
  if (frozen) return 1; // fase de extensão: imagem cobre tudo ("+3 min só com a imagem")
  if (tRel <= ov.fadeAt) return 1;
  const d = ov.fadeDur || 1.2;
  if (tRel <= ov.fadeAt + d) return 1 - ((tRel - ov.fadeAt) / d) * (1 - ov.finalOp);
  return ov.finalOp;
}

function paintLegend(ctx, W, H, c) {
  if (!c.text.trim()) return;
  const fs = Math.round((c.sizePct / 100) * W);
  ctx.save();
  ctx.font = `800 ${fs}px ui-sans-serif, system-ui, "Segoe UI", Roboto, Arial, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = c.opacity ?? 0.95;
  const padX = fs * 0.55, padY = fs * 0.42;
  const tw = ctx.measureText(c.text).width;
  const m = 0.03 * W;
  const bx = c.pos[1] === 'l' ? m : c.pos[1] === 'r' ? W - m - tw - padX * 2 : (W - tw - padX * 2) / 2;
  const by = c.pos[0] === 't' ? m + fs : H - m - padY;
  if (c.bar !== false) {
    ctx.globalAlpha = 0.55; ctx.fillStyle = '#000';
    ctx.fillRect(bx, by - fs - padY, tw + padX * 2, fs + padY * 2);
  }
  ctx.globalAlpha = c.opacity ?? 0.95; ctx.fillStyle = c.color || '#fff';
  ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = fs * 0.18;
  ctx.fillText(c.text, bx + padX, by);
  ctx.restore();
}

function paintTile(ctx, W, H, c) {
  if (!c.text.trim()) return;
  const fs = Math.round((c.sizePct / 100) * W);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(((c.angle ?? -45) * Math.PI) / 180);
  ctx.font = `800 ${fs}px ui-sans-serif, system-ui, "Segoe UI", Roboto, Arial, sans-serif`;
  ctx.globalAlpha = c.opacity ?? 0.16; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
  const tw = ctx.measureText(c.text).width;
  const stepX = tw + fs * 2.2, stepY = fs * 4.2;
  const diag = Math.hypot(W, H);
  for (let y = -diag; y <= diag; y += stepY)
    for (let x = -diag; x <= diag; x += stepX)
      ctx.fillText(c.text, x + ((Math.round(y / stepY) % 2) * stepX) / 2, y);
  ctx.restore();
}

function paintCaption(ctx, W, H, text, cap = {}) {
  let fs = Math.round((cap.sizePct || 4.5) * W / 100);
  ctx.save();
  ctx.font = `800 ${fs}px ui-sans-serif, system-ui, "Segoe UI", Roboto, Arial, sans-serif`;
  while (ctx.measureText(text).width > W * 0.9 && fs > 12) {
    fs -= 2;
    ctx.font = `800 ${fs}px ui-sans-serif, system-ui, "Segoe UI", Roboto, Arial, sans-serif`;
  }
  const padX = fs * 0.6, padY = fs * 0.45;
  const tw = ctx.measureText(text).width;
  const bw = tw + padX * 2;
  const by = cap.pos === 't' ? H * 0.05 : H - H * 0.07 - fs - padY;
  const bx = (W - bw) / 2;
  ctx.globalAlpha = 0.72; ctx.fillStyle = '#000';
  ctx.fillRect(bx, by - fs - padY, bw, fs + padY * 2);
  ctx.globalAlpha = 1; ctx.fillStyle = cap.color || '#fff';
  ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = fs * 0.15;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, bx + padX, by);
  ctx.restore();
}

/** Desenha UM frame da cena no canvas W×H (usado no loop e na prévia estática) */
export function drawScene(ctx, v, W, H, o, tRel, frozen) {
  const src = frozen || v;
  const sw = frozen ? W : v.videoWidth, sh = frozen ? H : v.videoHeight;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.save();
  if (o.perturb) ctx.translate(o.seedX || 0, o.seedY || 0); // hash único: jitter sub-pixel por exportação
  if (o.fit === 'cover') drawCover(ctx, src, sw, sh, W, H);
  else drawContained(ctx, src, sw, sh, W, H, o.bg === 'solid' ? 'solid' : 'blur', o.bgColor || '#10131a');
  ctx.restore();

  // censura (gerador de preview): blur ou pixelado na região, opcional só até Xs
  const c = o.censor;
  if (c && (!c.untilSec || tRel <= c.untilSec)) {
    const rx = (c.x ?? 0) * W, ry = (c.y ?? 0.35) * H;
    const rw = Math.max(1, (c.w ?? 1) * W), rh = Math.max(1, (c.h ?? 0.3) * H);
    const sc = scratchCv(), sctx = sc.getContext('2d');
    sc.width = W; sc.height = H; sctx.drawImage(ctx.canvas, 0, 0);
    ctx.save();
    ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.clip();
    if (c.mode === 'pixel') {
      const f = Math.max(6, c.px || 24);
      const sm = smallCv(), xctx = sm.getContext('2d');
      sm.width = Math.max(1, Math.round(rw / f)); sm.height = Math.max(1, Math.round(rh / f));
      xctx.imageSmoothingEnabled = true;
      xctx.drawImage(sc, rx, ry, rw, rh, 0, 0, sm.width, sm.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sm, 0, 0, sm.width, sm.height, rx, ry, rw, rh);
      ctx.imageSmoothingEnabled = true;
    } else {
      ctx.filter = `blur(${c.blurPx || 28}px)`;
      ctx.drawImage(sc, 0, 0);
      ctx.filter = 'none';
    }
    ctx.restore();
  }

  // cloaker de criativo: imagem em cima — 100% no início, fade até opacidade final
  if (o.overlay && o.overlay.img) {
    const op = overlayOpacity(o.overlay, tRel, frozen);
    if (op > 0.004) {
      ctx.save(); ctx.globalAlpha = op;
      if (o.overlay.fit === 'contain') {
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        const s = Math.min(W / o.overlay.imgWidth, H / o.overlay.imgHeight);
        ctx.drawImage(o.overlay.img, (W - o.overlay.imgWidth * s) / 2, (H - o.overlay.imgHeight * s) / 2, o.overlay.imgWidth * s, o.overlay.imgHeight * s);
      } else drawCover(ctx, o.overlay.img, o.overlay.imgWidth, o.overlay.imgHeight, W, H);
      ctx.restore();
    }
  }

  if (o.wm) { (o.wm.kind === 'tile' ? paintTile : paintLegend)(ctx, W, H, o.wm); }
  if (o.captions?.length) {
    const line = o.captions.find((c) => tRel >= c.start && tRel <= c.end);
    if (line) paintCaption(ctx, W, H, line.text, o.cap);
  }
  if (o.noise) {
    if (++noiseTick % 4 === 0) refreshNoise();
    ctx.globalAlpha = 0.02; ctx.drawImage(noiseCv(), 0, 0, W, H); ctx.globalAlpha = 1;
  }
}

// ---------- processamento principal ----------
/**
 * processVideo(file, opts, onProgress) → { blob, mime, ext, w, h, dur }
 * opts: start/end (trim), w/h ou auto, fit ('cover'|'fit'), bg ('blur'|'solid'), bgColor,
 *       overlay {img(file), fadeAt, fadeDur, finalOp, fit}, extendSec,
 *       censor {mode:'blur'|'pixel', px, blurPx, x,y,w,h (frações), untilSec},
 *       wm {text,pos,sizePct,color,opacity,bar|tile...}, captions [{start,end,text}], cap {sizePct,color},
 *       overlayAudioFile, volOriginal, volOverlay, loopOverlay, silent,
 *       bitrate (kbps→b/s já em bps), mp4, fps, perturb (hash único), noise (proteção premium)
 */
export async function processVideo(file, o = {}, onProgress = () => {}) {
  const { w: srcW, h: srcH, dur } = await probeVideo(file);
  if (!dur || !isFinite(dur)) throw new Error('Vídeo sem duração legível');
  const start = Math.min(Math.max(0, o.start || 0), Math.max(0, dur - 0.3));
  const end = Math.min(Math.max(start + 0.3, o.end ?? dur), dur);
  const { w: W, h: H } = targetSize(srcW, srcH, o);
  const extSec = Math.max(0, o.extendSec || 0);

  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { alpha: false });

  const opts = { ...o, seedX: o.perturb ? (Math.random() * 2 - 1) * 1.3 : 0, seedY: o.perturb ? (Math.random() * 2 - 1) * 1.3 : 0 };
  if (o.overlayImage) {
    const img = await new Promise((ok, fail) => {
      const url = URL.createObjectURL(o.overlayImage);
      const im = new Image();
      im.onload = () => ok({ img: im, imgWidth: im.naturalWidth, imgHeight: im.naturalHeight, url });
      im.onerror = () => fail(new Error('Imagem de cobertura inválida'));
      im.src = url;
    });
    opts.overlay = { ...(o.overlay || {}), img: img.img, imgWidth: img.imgWidth, imgHeight: img.imgHeight };
    opts._ovImgUrl = img.url;
  }

  // áudio: tudo passa pelo WebAudio (mixagem + gravação) — elemento fica "mudo" na UI
  const vurl = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.preload = 'auto'; v.playsInline = true; v.src = vurl;
  let ac = null, audioTrack = null, ovEl = null, ovUrl = null;
  await once(v, 'loadedmetadata');
  if (!o.silent) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ac = new AC();
    const dest = ac.createMediaStreamDestination();
    const gOrig = ac.createGain(); gOrig.gain.value = o.volOriginal ?? 1;
    ac.createMediaElementSource(v).connect(gOrig); gOrig.connect(dest); gOrig.connect(ac.destination);
    if (o.overlayAudioFile) {
      ovUrl = URL.createObjectURL(o.overlayAudioFile);
      ovEl = document.createElement('audio'); ovEl.src = ovUrl; ovEl.loop = !!o.loopOverlay;
      const gOv = ac.createGain(); gOv.gain.value = o.volOverlay ?? 0.8;
      ac.createMediaElementSource(ovEl).connect(gOv); gOv.connect(dest);
    }
    audioTrack = dest.stream.getAudioTracks()[0];
  }

  const stream = cv.captureStream(o.fps || 30);
  if (audioTrack) stream.addTrack(audioTrack);
  const mime = pickCodec(o.mp4 !== false);
  const rec = new MediaRecorder(stream, {
    mimeType: mime || undefined,
    videoBitsPerSecond: o.bitrate || 2_800_000,
    audioBitsPerSecond: 128_000,
  });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise((r) => { rec.onstop = r; });

  v.currentTime = start;
  await once(v, 'seeked');
  if (ac) await ac.resume().catch(() => {});
  rec.start(200);
  if (ovEl) { ovEl.currentTime = 0; await ovEl.play().catch(() => {}); }
  await v.play();

  const total = (end - start) + extSec;
  const tBegin = performance.now();
  let frozen = null;

  function stopAll() {
    v.pause();
    if (ovEl) ovEl.pause();
    if (rec.state !== 'inactive') try { rec.stop(); } catch { /* já parou */ }
    stream.getTracks().forEach((t) => t.stop());
  }

  await new Promise((resolve) => {
    let done = false;
    function tick(now) {
      if (done) return;
      const tRel = v.currentTime - start;
      const atEnd = tRel >= (end - start) - 0.06;
      if (atEnd && !v.paused) v.pause();
      if (atEnd && !frozen) {
        frozen = document.createElement('canvas'); frozen.width = W; frozen.height = H;
        frozen.getContext('2d').drawImage(cv, 0, 0);
      }
      drawScene(ctx, v, W, H, opts, Math.min(tRel, end - start), frozen);
      onProgress(Math.min(1, (now - tBegin) / 1000 / total));
      const extT = extSec > 0 && atEnd ? (now - tBegin) / 1000 - (end - start) : 0;
      if ((extSec <= 0 && atEnd) || (extSec > 0 && atEnd && extT >= extSec)) { done = true; stopAll(); resolve(); return; }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });

  await stopped;
  await new Promise((r) => setTimeout(r, 80)); // flush dos últimos chunks
  const blob = new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] });
  if (ac) await ac.close().catch(() => {});
  URL.revokeObjectURL(vurl);
  if (ovUrl) URL.revokeObjectURL(ovUrl);
  if (opts._ovImgUrl) URL.revokeObjectURL(opts._ovImgUrl);
  if (!blob.size) throw new Error('O navegador não gravou o vídeo (codec indisponível?)');
  return { blob, mime: blob.type, ext: codecExt(blob.type), w: W, h: H, dur: total };
}

/** Prévia estática: desenha o frame em tAbs com os mesmos transformes no canvas do caller */
export async function framePreview(v, o, canvas, tAbs = 1) {
  const t = Math.min(Math.max(0, tAbs), Math.max(0, (v.duration || 0) - 0.05));
  if (Math.abs(v.currentTime - t) > 0.08) { v.currentTime = t; await once(v, 'seeked'); }
  drawScene(canvas.getContext('2d'), v, canvas.width, canvas.height, o, t - (o.start || 0), null);
}

// ---------- áudio → WAV (sem dependências; MP3 entra como pendência) ----------
export async function audioToWav(file) {
  const buf = await file.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  const aud = await ac.decodeAudioData(buf);
  const ch = Math.min(2, aud.numberOfChannels), sr = aud.sampleRate, n = aud.length;
  const ab = new ArrayBuffer(44 + n * ch * 2);
  const dv = new DataView(ab);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); dv.setUint32(4, ab.byteLength - 8, true); ws(8, 'WAVE');
  ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
  ws(36, 'data'); dv.setUint32(40, n * ch * 2, true);
  const L = aud.getChannelData(0), R = ch > 1 ? aud.getChannelData(1) : null;
  let off = 44;
  for (let i = 0; i < n; i++) {
    let s = Math.max(-1, Math.min(1, L[i]));
    dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2;
    if (R) { s = Math.max(-1, Math.min(1, R[i])); dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2; }
  }
  await ac.close();
  return { blob: new Blob([ab], { type: 'audio/wav' }), dur: aud.duration };
}

// ---------- legendas: SRT ou linhas "início-fim texto" ----------
/** "00:00:02,500" | "1:15" | "1:02.4" | "2.4" | "45" → segundos */
function ts(s) {
  const t = String(s).trim();
  const parts = t.split(':');
  const okInt = (x) => /^\d+$/.test(x || '');
  const frac = (x) => (x ? Number(x.padEnd(3, '0')) / 1000 : 0);
  if (parts.length === 3) { // H:MM:SS[,mmm]
    const [h, mm, ssRaw] = parts;
    const [ss, ms] = ssRaw.split(/[.,]/);
    if (!okInt(h) || !okInt(mm) || !okInt(ss)) return NaN;
    return (+h) * 3600 + (+mm) * 60 + (+ss) + frac(ms);
  }
  if (parts.length === 2) { // M:SS[,mmm]
    const [a, bRaw] = parts;
    const [b, ms] = bRaw.split(/[.,]/);
    if (!okInt(a) || !okInt(b)) return NaN;
    return (+a) * 60 + (+b) + frac(ms);
  }
  if (/^\d+(?:[.,]\d{1,3})?$/.test(t)) { // segundos puros
    const [w, x] = t.split(/[.,]/);
    return (+w) + frac(x);
  }
  return NaN;
}
export function parseCaptions(raw) {
  const out = [];
  for (const blk of String(raw || '').split(/\r?\n\s*\r?\n/)) {
    const lines = blk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const li = lines.findIndex((l) => /-->/.test(l));
    if (li !== -1) {
      const [a, b] = lines[li].split('-->');
      const txt = lines.slice(li + 1).filter((l) => !/^\d+$/.test(l)).join(' ');
      if (isFinite(ts(a)) && isFinite(ts(b)) && txt) out.push({ start: ts(a), end: ts(b), text: txt });
      continue;
    }
    for (const l of lines) {
      const m = l.match(/^([\d:.]+)\s*[-–→]\s*([\d:.]+)\s+(.+)$/);
      if (m) { if (isFinite(ts(m[1])) && isFinite(ts(m[2]))) out.push({ start: ts(m[1]), end: ts(m[2]), text: m[3] }); continue; }
      if (out.length && !/[\d:.]{3,}/.test(l)) out[out.length - 1].text += ' ' + l;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---------- utilidades ----------
export async function sha256hex(blob) {
  const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const fmtBytes = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? (n / 1024).toFixed(0) + ' KB' : n + ' B';
export const fmtSec = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** Painel de resultado padrão p/ tools de vídeo: player + meta + hash + download */
export function showVideoResult(el, { blob, name, ext, sha, sizeNote }) {
  el.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'vidres';
  const url = URL.createObjectURL(blob);
  const vid = document.createElement(ext === 'webm' ? 'video' : 'video');
  vid.src = url; vid.controls = true; vid.playsInline = true;
  const a = document.createElement('a');
  a.className = 'btn acc'; a.href = url; a.download = `${name}.${ext}`;
  a.textContent = `⬇ Baixar .${ext} (${fmtBytes(blob.size)})`;
  const meta = document.createElement('div');
  meta.className = 'vidmeta';
  meta.textContent = sizeNote || `Saída: ${fmtBytes(blob.size)}`;
  if (sha) {
    const hb = document.createElement('div');
    hb.className = 'hashbox';
    hb.innerHTML = `<span>SHA-256 (arquivo único)</span><code>${sha}</code>`;
    meta.appendChild(hb);
  }
  box.append(vid, a, meta);
  el.appendChild(box);
  return () => URL.revokeObjectURL(url);
}
