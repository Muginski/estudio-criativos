// ============================================================
// Tool — Gerador de Preview (censura de região) · 100% no navegador
// Paridade com "previa" do Rateio Hot: mostra o vídeo pro parceiro
// com a parte quente borrada/pixelada, no todo ou só até X segundos.
// Prévia ao vivo: arrasta o play e vê o efeito em tempo real.
// ============================================================
import { processVideo, probeVideo, showVideoResult, framePreview, fmtBytes } from '../lib/video.js';
import { bindDrop, checkVideo, fileLine, outName } from '../lib/vtool.js';

export function initPreview(root, { toast }) {
  root.innerHTML = `
  <section class="card gated">
    <h2>Gerador de preview <span class="badge-pro">PRO</span></h2>
    <p class="sub">Envia o vídeo pro parceiro com a parte sensível borrada — ou pixelada — no todo, ou só até você deixar ele ver. O efeito aparece ao vivo enquanto arrasta o tempo.</p>
    <div class="drop" id="pv-drop">🎬 <b>Arraste o vídeo aqui</b> ou clique para escolher<input type="file" id="pv-input" accept="video/*" hidden>
      <small>MP4/MOV/WebM · 33 MB máx · 180 s máx</small></div>
    <div id="pv-info"></div>
    <div id="pv-edit" hidden>
      <div class="stage" style="margin-top:14px"><video id="pv-src" controls playsinline style="max-height:380px"></video></div>
      <div class="row" style="margin-top:12px" id="pv-mode">
        <button class="opt is-on" data-k="blur">Borrão suave</button>
        <button class="opt" data-k="pixel">Pixelado</button>
      </div>
      <div class="row" style="margin-top:10px;gap:14px;flex-wrap:wrap">
        <label class="fld grow"><span>Força <b id="pv-str-v">forte</b></span><input type="range" id="pv-str" min="1" max="10" value="6"></label>
        <label class="fld grow"><span>Só censurar até <b id="pv-until-v">todo o vídeo</b> (s)</span><input type="range" id="pv-until" min="0" max="180" step="1" value="0"></label>
      </div>
      <div class="row" style="margin-top:4px;gap:14px;flex-wrap:wrap">
        <label class="fld grow"><span>Centro X <b id="pv-x-v">50%</b></span><input type="range" id="pv-x" min="0" max="100" value="50"></label>
        <label class="fld grow"><span>Posição Y (do topo) <b id="pv-y-v">35%</b></span><input type="range" id="pv-y" min="0" max="90" value="35"></label>
        <label class="fld grow"><span>Largura da área <b id="pv-w-v">60%</b></span><input type="range" id="pv-w" min="10" max="100" value="60"></label>
        <label class="fld grow"><span>Altura da área <b id="pv-h-v">30%</b></span><input type="range" id="pv-h" min="8" max="100" value="30"></label>
      </div>
    </div>
    <div class="row" style="margin-top:14px"><button class="btn acc" id="pv-run" disabled>👀 Exportar preview</button></div>
    <div class="prog" id="pv-prog" hidden><i></i></div>
    <div id="pv-res"></div>
  </section>`;

  const $ = (s) => root.querySelector(s);
  let vFile = null, vMeta = null, busy = false, mode = 'blur', tRel0 = 0;

  const opts = () => {
    const str = +$('#pv-str').value;
    return { censor: { mode, blurPx: 8 + str * 6, px: 10 + str * 5, x: +$('#pv-x').value / 100, y: +$('#pv-y').value / 100, w: +$('#pv-w').value / 100, h: +$('#pv-h').value / 100, untilSec: +$('#pv-until').value || 0 } };
  };

  bindDrop(root, $('#pv-drop'), $('#pv-input'), async ([f]) => {
    const err = checkVideo(f); if (err) return toast(err, 'err');
    try {
      vMeta = await probeVideo(f); vFile = f;
      const v = $('#pv-src'); v.src = URL.createObjectURL(f);
      $('#pv-drop').style.display = 'none';
      $('#pv-info').innerHTML = `<div class="fileline" style="margin-top:14px">📎 <b>${f.name}</b><span class="fdet">${vMeta.w}×${vMeta.h} · ${fmtBytes(f.size)}</span></div>`;
      $('#pv-edit').hidden = false;
      $('#pv-until').max = Math.round(vMeta.dur);
      $('#pv-run').disabled = false;
      drawPrev();
    } catch { toast('Não foi possível ler o vídeo', 'err'); }
  });

  $('#pv-mode').querySelectorAll('.opt').forEach((o) => o.onclick = () => {
    mode = o.dataset.k;
    $('#pv-mode').querySelectorAll('.opt').forEach((x) => x.classList.toggle('is-on', x === o));
    drawPrev();
  });
  for (const [id, vid, fmt] of [['pv-str', 'pv-str-v', (v) => ['fraca', 'leve', 'leve', 'média', 'média', 'forte', 'forte', 'pesada', 'pesada', 'total'][+v - 1]], ['pv-until', 'pv-until-v', (v) => +v ? `até ${v}s` : 'todo o vídeo'], ['pv-x', 'pv-x-v', (v) => v + '%'], ['pv-y', 'pv-y-v', (v) => v + '%'], ['pv-w', 'pv-w-v', (v) => v + '%'], ['pv-h', 'pv-h-v', (v) => v + '%']]) {
    $('#' + id).oninput = (e) => { $('#' + vid).textContent = fmt(e.target.value); drawPrev(); };
  }

  let raf = 0;
  function drawPrev() {
    const v = $('#pv-src');
    if (!vFile || !v.videoWidth) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(async () => {
      const sc = Math.min(1, 480 / v.videoWidth);
      const W = v.videoWidth * sc & ~1, H = v.videoHeight * sc & ~1;
      let pv = $('#pv-prevcv');
      if (!pv) { pv = document.createElement('canvas'); pv.id = 'pv-prevcv'; pv.className = 'vmprev'; $('#pv-edit').prepend(pv); }
      pv.width = W; pv.height = H;
      await framePreview(v, opts(), pv, tRel0).catch(() => {});
    });
  }
  $('#pv-src').ontimeupdate = () => { tRel0 = $('#pv-src').currentTime; drawPrev(); };

  $('#pv-run').onclick = async () => {
    if (busy || !vFile) return; busy = true; $('#pv-run').disabled = true;
    const prog = $('#pv-prog'); prog.hidden = false; prog.querySelector('i').style.width = '2%';
    $('#pv-res').innerHTML = '';
    try {
      const out = await processVideo(vFile, { ...opts(), w: vMeta.w & ~1, h: vMeta.h & ~1, bitrate: 2_800_000 },
        (p) => { prog.querySelector('i').style.width = Math.round(2 + p * 98) + '%'; });
      showVideoResult($('#pv-res'), { blob: out.blob, name: outName(vFile, '-preview'), ext: out.ext, sizeNote: `Censura ${mode === 'blur' ? 'borrada' : 'pixelada'} ${+$('#pv-until').value ? `só até ${$('#pv-until').value}s` : 'no vídeo inteiro'}` });
      toast('Preview pronto pra enviar!', 'ok');
    } catch (e) { toast(e.message, 'err'); }
    finally { busy = false; $('#pv-run').disabled = false; }
  };
  return {};
}
