// ============================================================
// Tool — Limpar Metadados (imagem, vídeo e áudio) · 100% no navegador
// Paridade com "limpar" do Rateio Hot: tira localização, data e
// app que gravou o arquivo. Imagem: re-draw no canvas (EXIF sai).
// Vídeo: re-encode via canvas+recorder (metadados não sobrevivem).
// Áudio: decode → WAV limpo.
// ============================================================
import { loadImage, slug } from '../lib/canvas.js';
import { processVideo, audioToWav, showVideoResult, probeVideo, fmtBytes } from '../lib/video.js';
import { bindDrop, isVideoFile, isImageFile, isAudioFile, checkVideo, outName } from '../lib/vtool.js';

export function initClean(root, { toast }) {
  root.innerHTML = `
  <section class="card gated">
    <h2>Limpar metadados <span class="badge-pro">PRO</span></h2>
    <p class="sub">Tira localização, data, aparelho e aplicativo do arquivo. O arquivo novo sai do zero — sem nenhum rastro do original. Discrição total pra quem não quer que descubram de onde veio o material.</p>
    <div class="drop" id="cn-drop">🧼 <b>Arraste imagem, vídeo ou áudio aqui</b> ou clique para escolher<input type="file" id="cn-input" accept="image/*,video/*,audio/*" hidden>
      <small>JPG/PNG/WebP · MP4/MOV/WebM · MP3/WAV/M4A</small></div>
    <div id="cn-info"></div>
    <div class="row" style="margin-top:14px" id="cn-extra">
      <label class="chk"><input type="radio" name="cn-fmt" value="jpg" checked> JPG (92%)</label>
      <label class="chk"><input type="radio" name="cn-fmt" value="png"> PNG sem perdas</label>
    </div>
    <div class="row" style="margin-top:14px"><button class="btn acc" id="cn-run" disabled>🧼 Limpar arquivo</button></div>
    <div class="prog" id="cn-prog" hidden><i></i></div>
    <div id="cn-res"></div>
  </section>`;

  const $ = (s) => root.querySelector(s);
  const drop = $('#cn-drop'), input = $('#cn-input'), runBtn = $('#cn-run'), prog = $('#cn-prog'), bar = prog.querySelector('i');
  let job = null, busy = false;

  bindDrop(root, drop, input, ([f]) => {
    const kind = isVideoFile(f) ? 'video' : isImageFile(f) ? 'image' : isAudioFile(f) ? 'audio' : null;
    if (!kind) return toast('Formato não suportado aqui', 'err');
    if (kind === 'video') { const err = checkVideo(f); if (err) return toast(err, 'err'); }
    else if (f.size > 50 * 1024 * 1024) return toast('Máximo 50 MB p/ imagem/áudio', 'err');
    job = { file: f, kind };
    drop.style.display = 'none';
    $('#cn-info').innerHTML = `<div class="fileline" style="margin-top:14px">📎 <b>${f.name}</b><span class="fdet">${kind === 'video' ? 'vídeo' : kind === 'image' ? 'imagem' : 'áudio'} · ${fmtBytes(f.size)}</span> <button class="btn sm ghost" id="cn-clear">trocar</button></div>`;
    $('#cn-extra').style.display = kind === 'image' ? 'flex' : 'none';
    runBtn.disabled = false;
  });
  const clearWatch = () => {
    const b = $('#cn-clear');
    if (b) b.onclick = () => { job = null; runBtn.disabled = true; drop.style.display = ''; $('#cn-info').innerHTML = ''; $('#cn-res').innerHTML = ''; };
  };
  new MutationObserver(clearWatch).observe($('#cn-info'), { childList: true });

  runBtn.onclick = async () => {
    if (busy || !job) return; busy = true; runBtn.disabled = true; prog.hidden = false; bar.style.width = '2%'; $('#cn-res').innerHTML = '';
    const res = $('#cn-res');
    try {
      const f = job.file;
      if (job.kind === 'image') {
        const L = await loadImage(f);
        const cv = document.createElement('canvas'); cv.width = L.w; cv.height = L.h;
        cv.getContext('2d').drawImage(L.img, 0, 0);
        const fmt = root.querySelector('input[name="cn-fmt"]:checked').value;
        const blob = await new Promise((r) => cv.toBlob(r, fmt === 'png' ? 'image/png' : 'image/jpeg', 0.92));
        const dlUrl = URL.createObjectURL(blob);
        setTimeout(() => { URL.revokeObjectURL(L.url); URL.revokeObjectURL(dlUrl); }, 4000);
        res.innerHTML = `<div class="vidres"><img src="${L.url}" alt="prévia" style="max-width:100%;max-height:340px;border-radius:8px">
          <a class="btn acc" href="${dlUrl}" download="${slug(outName(f, '-limpo'))}.${fmt}">⬇ Baixar limpo (${fmtBytes(blob.size)})</a>
          <div class="vidmeta">Novo arquivo sem EXIF/GPS/histórico. ${blob.size < f.size ? `Também ficou menor: ${fmtBytes(f.size)} → ${fmtBytes(blob.size)}.` : ''}</div></div>`;
        toast('Imagem limpa!', 'ok');
      } else if (job.kind === 'video') {
        const meta = await probeVideo(f);
        const out = await processVideo(f, { w: meta.w & ~1, h: meta.h & ~1 }, (p) => { bar.style.width = Math.round(2 + p * 98) + '%'; });
        showVideoResult(res, { blob: out.blob, name: outName(f, '-limpo'), ext: out.ext, sizeNote: 'Vídeo regravado do zero — nenhum metadado do original sobrevive.' });
        toast('Vídeo limpo!', 'ok');
      } else {
        const { blob, dur } = await audioToWav(f);
        res.innerHTML = `<div class="vidres"><audio controls src="${URL.createObjectURL(blob)}" style="width:100%"></audio>
          <a class="btn acc" href="${URL.createObjectURL(blob)}" download="${slug(outName(f, '-limpo'))}.wav">⬇ Baixar WAV (${fmtBytes(blob.size)})</a>
          <div class="vidmeta">Áudio redecodificado pra WAV limpo · ${Math.round(dur)}s. (MP3 fica na fila — WAV é lossless.)</div></div>`;
        toast('Áudio limpo!', 'ok');
      }
    } catch (e) { toast(e.message, 'err'); }
    finally { busy = false; runBtn.disabled = false; }
  };
  return {};
}
