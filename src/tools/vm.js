// ============================================================
// Tool — Legenda & marca d'água EM VÍDEO · 100% no navegador
// Paridade com "marca" do Rateio Hot (vídeo): texto posicionado ou
// tilé diagonal queimados no frame, com prévia ao vivo por seek.
// ============================================================
import { processVideo, probeVideo, showVideoResult, framePreview, fmtBytes } from '../lib/video.js';
import { bindDrop, checkVideo, fileLine, outName } from '../lib/vtool.js';

const POS = { bl: 'baixo-esq', bc: 'baixo-centro', br: 'baixo-dir', tl: 'topo-esq', tc: 'topo-centro', tr: 'topo-dir' };

export function initVM(root, { toast }) {
  root.innerHTML = `
  <section class="card gated">
    <h2>Marca em vídeo <span class="badge-pro">PRO</span></h2>
    <p class="sub">Legenda queimada na posição certa — ou sua marca repetida em tilé contra print solto do seu material.</p>
    <div class="drop" id="vm-drop">🎬 <b>Arraste o vídeo aqui</b> ou clique para escolher<input type="file" id="vm-input" accept="video/*" hidden>
      <small>MP4/MOV/WebM · 33 MB máx · 180 s máx</small></div>
    <div id="vm-info"></div>
    <div id="vm-edit" hidden>
      <div class="stage" style="margin-top:14px"><video id="vm-src" controls playsinline style="max-height:380px"></video></div>
      <div class="row" style="margin-top:12px" id="vm-mode">
        <button class="opt is-on" data-k="legend">Legenda (texto)</button>
        <button class="opt" data-k="tile">Marca tilé</button>
      </div>
      <div class="row" style="margin-top:10px">
        <label class="fld grow"><span>Texto</span><input type="text" id="vm-text" value="SEU TEXTO AQUI" maxlength="40"></label>
        <label class="fld"><span>Tamanho <b id="vm-size-v">4%</b></span><input type="range" id="vm-size" min="1.5" max="9" step="0.25" value="4"></label>
      </div>
      <div class="row" style="margin-top:4px" id="vm-posrow">
        <div class="opts" id="vm-pos">${Object.entries(POS).map(([k, n]) => `<button class="opt${k === 'bc' ? ' is-on' : ''}" data-p="${k}">${n}</button>`).join('')}</div>
      </div>
      <div class="row" style="margin-top:4px">
        <label class="chk"><input type="color" id="vm-color" value="#ffffff"><span> cor</span></label>
        <label class="fld grow"><span>Opacidade <b id="vm-op-v">95%</b></span><input type="range" id="vm-op" min="5" max="100" step="5" value="95"></label>
        <label class="chk"><input type="checkbox" id="vm-bar" checked> faixa de fundo</label>
      </div>
    </div>
    <div class="row" style="margin-top:14px"><button class="btn acc" id="vm-run" disabled>🔥 Queimar no vídeo</button></div>
    <div class="prog" id="vm-prog" hidden><i></i></div>
    <div id="vm-res"></div>
  </section>`;

  const $ = (s) => root.querySelector(s);
  let vFile = null, vMeta = null, busy = false, kind = 'legend', pos = 'bc', tRel0 = 0;

  const opts = () => ({ wm: { kind, text: $('#vm-text').value, pos, sizePct: +$('#vm-size').value, color: $('#vm-color').value, opacity: +$('#vm-op').value / 100, bar: $('#vm-bar').checked, angle: -45 } });

  bindDrop(root, $('#vm-drop'), $('#vm-input'), async ([f]) => {
    const err = checkVideo(f); if (err) return toast(err, 'err');
    try {
      vMeta = await probeVideo(f); vFile = f;
      const v = $('#vm-src'); v.src = URL.createObjectURL(f);
      $('#vm-drop').style.display = 'none';
      $('#vm-info').innerHTML = `<div class="fileline" style="margin-top:14px">📎 <b>${f.name}</b><span class="fdet">${vMeta.w}×${vMeta.h} · ${fmtBytes(f.size)}</span></div>`;
      $('#vm-edit').hidden = false;
      $('#vm-run').disabled = false;
      drawPrev();
    } catch { toast('Não foi possível ler o vídeo', 'err'); }
  });

  $('#vm-mode').querySelectorAll('.opt').forEach((o) => o.onclick = () => {
    kind = o.dataset.k;
    $('#vm-mode').querySelectorAll('.opt').forEach((x) => x.classList.toggle('is-on', x === o));
    $('#vm-posrow').style.display = kind === 'legend' ? '' : 'none';
    drawPrev();
  });
  $('#vm-pos').querySelectorAll('.opt').forEach((o) => o.onclick = () => {
    pos = o.dataset.p;
    $('#vm-pos').querySelectorAll('.opt').forEach((x) => x.classList.toggle('is-on', x === o));
    drawPrev();
  });
  for (const [id, vid] of [['vm-size', 'vm-size-v'], ['vm-op', 'vm-op-v']]) $('#'+id).oninput = (e) => { $('#'+vid).textContent = (+e.target.value % 1 ? (+e.target.value).toFixed(2) : e.target.value) + '%'; drawPrev(); };
  for (const s of ['text', 'color', 'bar']) $('#vm-' + s).oninput = drawPrev;
  $('#vm-src').ontimeupdate = () => { tRel0 = $('#vm-src').currentTime; drawPrev(true); };

  // prévia: desenha o frame atual com os transformes numa cópia pequena
  let prevCv = null;
  function drawPrev(keepTime = false) {
    const v = $('#vm-src');
    if (!vFile || !v.videoWidth) return;
    const sc = Math.min(1, 480 / v.videoWidth);
    const W = v.videoWidth * sc & ~1, H = v.videoHeight * sc & ~1;
    if (!prevCv) { prevCv = document.createElement('canvas'); }
    if (!prevCv.width || prevCv.width !== W) { prevCv.width = W; prevCv.height = H; }
    const o = opts(); // escala o tamanho de fonte p/ a prévia proporcional
    o.wm.sizePct = o.wm.sizePct * (prevCv.width / (vMeta ? vMeta.w : W));
    if (keepTime) framePreview(v, o, prevCv, tRel0).catch(() => {});
    else if (Math.abs(v.currentTime - 1) > 0.1) v.currentTime = Math.min(1, Math.max(0, (v.duration || 1) - 0.1));
    else framePreview(v, o, prevCv, v.currentTime).catch(() => {});
    let pv = $('#vm-prev');
    if (!pv) { pv = document.createElement('canvas'); pv.id = 'vm-prev'; pv.className = 'vmprev'; $('#vm-edit').prepend(pv); }
    pv.width = W; pv.height = H;
    pv.getContext('2d').drawImage(prevCv, 0, 0);
  }

  $('#vm-run').onclick = async () => {
    if (busy || !vFile) return; busy = true; $('#vm-run').disabled = true;
    const prog = $('#vm-prog'); prog.hidden = false; prog.querySelector('i').style.width = '2%';
    $('#vm-res').innerHTML = '';
    try {
      const out = await processVideo(vFile, { ...opts(), w: vMeta.w & ~1, h: vMeta.h & ~1, bitrate: 3_200_000 },
        (p) => { prog.querySelector('i').style.width = Math.round(2 + p * 98) + '%'; });
      showVideoResult($('#vm-res'), { blob: out.blob, name: outName(vFile, kind === 'tile' ? '-marca' : '-leg'), ext: out.ext });
      toast('Queimado no vídeo!', 'ok');
    } catch (e) { toast(e.message, 'err'); }
    finally { busy = false; $('#vm-run').disabled = false; }
  };
  return {};
}
