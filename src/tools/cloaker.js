// ============================================================
// Tool — Cloaker de Criativo (variações) · 100% no navegador
// Paridade com "variacoes" do Rateio Hot: imagem por cima do vídeo
// (100% no primeiro instante → opacidade baixa), extensão só com a
// imagem (+3 min) e hash 100% único por exportação.
// ============================================================
import { processVideo, probeVideo, showVideoResult, sha256hex, fmtBytes, fmtSec } from '../lib/video.js';
import { bindDrop, checkVideo, fileLine, outName, isImageFile } from '../lib/vtool.js';

export function initCloaker(root, { toast }) {
  root.innerHTML = `
  <section class="card gated">
    <h2>Cloaker de criativo <span class="badge-pro">PRO</span></h2>
    <p class="sub">Coloca uma imagem por cima do vídeo: 100% no primeiro instante, depois com opacidade baixa. Dá pra estender com a imagem. Cada exportação sai com hash único — a rede trata como criativo novo.</p>
    <div class="row" style="gap:14px">
      <div style="flex:1;min-width:240px">
        <div class="drop" id="cl-drop">🎬 <b>Vídeo base</b><input type="file" id="cl-input" accept="video/*" hidden><small>MP4/MOV/WebM · 33 MB · 180 s</small></div>
      </div>
      <div style="flex:1;min-width:240px">
        <div class="drop" id="cl-imgdrop">🖼️ <b>Imagem de cobertura</b> <small>(opcional — sem ela, só hash único)</small><input type="file" id="cl-imginput" accept="image/*" hidden></div>
      </div>
    </div>
    <div id="cl-info"></div>
    <div class="row" style="margin-top:14px;gap:14px;flex-wrap:wrap">
      <label class="fld grow"><span>Começa a sumir em <b id="cl-fadeAt-v">1.0s</b></span>
        <input type="range" id="cl-fadeAt" min="0" max="5" step="0.1" value="1"></label>
      <label class="fld grow"><span>Sumiço em <b id="cl-fadeDur-v">1.2s</b></span>
        <input type="range" id="cl-fadeDur" min="0.2" max="5" step="0.1" value="1.2"></label>
      <label class="fld grow"><span>Opacidade final <b id="cl-finalOp-v">6%</b></span>
        <input type="range" id="cl-finalOp" min="0" max="40" step="1" value="6"></label>
    </div>
    <div class="row" style="margin-top:4px;gap:14px;flex-wrap:wrap">
      <label class="fld grow"><span>Estender o final só com a imagem: <b id="cl-ext-v">sem extensão</b></span>
        <input type="range" id="cl-ext" min="0" max="180" step="5" value="0"></label>
    </div>
    <div class="row" style="margin-top:6px">
      <label class="chk"><input type="checkbox" id="cl-perturb" checked> Hash 100% único por exportação</label>
      <label class="chk"><input type="checkbox" id="cl-noise"> Proteção premium (ruído subliminar)</label>
    </div>
    <div class="row" style="margin-top:14px"><button class="btn acc" id="cl-run" disabled>✨ Gerar variação</button></div>
    <div class="prog" id="cl-prog" hidden><i></i></div>
    <div id="cl-res"></div>
  </section>`;

  const $ = (s) => root.querySelector(s);
  let vFile = null, imgFile = null, busy = false;

  bindDrop(root, $('#cl-drop'), $('#cl-input'), async ([f]) => {
    const err = checkVideo(f); if (err) return toast(err, 'err');
    try {
      const meta = await probeVideo(f); vFile = f; refresh();
      toast(`Vídeo ${meta.w}×${meta.h} · ${fmtSec(meta.dur)} carregado`, 'ok');
    } catch { toast('Não foi possível ler o vídeo', 'err'); }
  });
  bindDrop(root, $('#cl-imgdrop'), $('#cl-imginput'), ([f]) => {
    if (!isImageFile(f)) return toast('Escolha uma imagem (JPG/PNG)', 'err');
    imgFile = f; refresh(); toast('Imagem de cobertura pronta', 'ok');
  });

  function refresh() {
    $('#cl-info').innerHTML = (vFile ? `<div class="fileline" style="margin-top:14px">📎 <b>${vFile.name}</b><span class="fdet">${imgFile ? `cobertura: ${imgFile.name}` : 'sem imagem de cobertura (só hash único)'}</span></div>` : '');
    $('#cl-run').disabled = !vFile;
  }
  for (const [id, vid, fmt] of [['cl-fadeAt', 'cl-fadeAt-v', (v) => (+v).toFixed(1) + 's'], ['cl-fadeDur', 'cl-fadeDur-v', (v) => (+v).toFixed(1) + 's'], ['cl-finalOp', 'cl-finalOp-v', (v) => v + '%'], ['cl-ext', 'cl-ext-v', (v) => +v ? `+${v}s` : 'sem extensão']]) {
    const el = $('#' + id), lab = $('#' + vid);
    el.oninput = () => { lab.textContent = fmt(el.value); };
  }

  $('#cl-run').onclick = async () => {
    if (busy || !vFile) return; busy = true; $('#cl-run').disabled = true;
    $('#cl-prog').hidden = false; $('#cl-prog i').style.width = '2%'; $('#cl-res').innerHTML = '';
    try {
      const opts = {
        perturb: $('#cl-perturb').checked,
        noise: $('#cl-noise').checked,
        extendSec: Math.max(0, +$('#cl-ext').value),
        bitrate: 3_200_000,
      };
      if (imgFile) {
        opts.overlayImage = imgFile;
        opts.overlay = { fadeAt: +$('#cl-fadeAt').value, fadeDur: +$('#cl-fadeDur').value, finalOp: +$('#cl-finalOp').value / 100 };
      }
      const out = await processVideo(vFile, opts, (p) => { $('#cl-prog i').style.width = Math.round(2 + p * 98) + '%'; });
      const sha = await sha256hex(out.blob);
      showVideoResult($('#cl-res'), { blob: out.blob, name: outName(vFile, '-cloak-' + Date.now().toString(36)), ext: out.ext, sha });
      toast('Variação gerada — hash novo confirmado', 'ok');
    } catch (e) { toast(e.message, 'err'); }
    finally { busy = false; $('#cl-run').disabled = false; }
  };
  return {};
}
