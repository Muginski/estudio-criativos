// ============================================================
// Tool — Cortar vídeo (trim) · 100% no navegador
// Paridade com "cortar" do Rateio Hot, sem upload: eles mandam
// pro servidor (TTL 24h), aqui nada sai do aparelho.
// ============================================================
import { processVideo, probeVideo, showVideoResult, fmtBytes, fmtSec } from '../lib/video.js';
import { bindDrop, checkVideo, fileLine, outName } from '../lib/vtool.js';

export function initTrim(root, { toast }) {
  root.innerHTML = `
  <section class="card gated">
    <h2>Cortar vídeo <span class="badge-pro">PRO</span></h2>
    <p class="sub">Corta o início e o fim sem perder qualidade percebida — o novo corte já sai pronto pra subir no anúncio.</p>
    <div class="drop" id="tr-drop">🎬 <b>Arraste o vídeo aqui</b> ou clique para escolher<input type="file" id="tr-input" accept="video/*" hidden>
      <small>MP4/MOV/WebM · 33 MB máx · 180 s máx</small></div>
    <div id="tr-info" hidden>
      <div id="tr-file" style="margin-top:14px"></div>
      <div class="row">
        <label class="fld" style="flex:1;min-width:110px"><span>Início (s)</span><input type="number" id="tr-s" min="0" step="0.1" value="0"></label>
        <label class="fld" style="flex:1;min-width:110px"><span>Fim (s)</span><input type="number" id="tr-e" min="0.3" step="0.1" value="0"></label>
      </div>
      <div class="row presets">
        <button class="opt" data-p="3f">primeiros 3s</button>
        <button class="opt" data-p="5f">primeiros 5s</button>
        <button class="opt" data-p="5l">últimos 5s</button>
      </div>
      <div class="row" style="margin-top:6px"><span id="tr-dur" style="font-size:12.5px;color:var(--mut)"></span></div>
    </div>
    <div class="row" style="margin-top:14px">
      <button class="btn acc" id="tr-run" disabled>✂ Cortar</button>
    </div>
    <div class="prog" id="tr-prog" hidden><i></i></div>
    <p class="note">O processamento roda no seu aparelho — nenhum frame sai daqui.</p>
    <div id="tr-res"></div>
  </section>`;

  const $ = (s) => root.querySelector(s);
  const drop = $('#tr-drop'), input = $('#tr-input'), info = $('#tr-info');
  const sIn = $('#tr-s'), eIn = $('#tr-e'), runBtn = $('#tr-run'), prog = $('#tr-prog'), bar = prog.querySelector('i');
  let job = null, busy = false;

  bindDrop(root, drop, input, async ([f]) => {
    const err = checkVideo(f); if (err) return toast(err, 'err');
    try {
      const meta = await probeVideo(f);
      job = { file: f, w: meta.w & ~1, h: meta.h & ~1, dur: meta.dur };
      drop.style.display = 'none'; info.hidden = false;
      $('#tr-file').innerHTML = fileLine(f.name, `${meta.w}×${meta.h} · ${fmtSec(meta.dur)} · ${fmtBytes(f.size)}`);
      eIn.value = meta.dur.toFixed(1); eIn.max = meta.dur.toFixed(1);
      sIn.max = (meta.dur - 0.3).toFixed(1);
      $('#tr-dur').textContent = `Duração total: ${fmtSec(meta.dur)} · corte atual: ${(Math.min(meta.dur, +eIn.value) - +sIn.value).toFixed(1)}s`;
      runBtn.disabled = false;
      toast('Vídeo carregado', 'ok');
    } catch { toast('Não foi possível ler o vídeo', 'err'); }
  });

  const sync = () => {
    const d = job.dur;
    let s = Math.max(0, Math.min(+sIn.value || 0, d - 0.3)), e = Math.max(s + 0.3, Math.min(+eIn.value || d, d));
    sIn.value = s.toFixed(1); eIn.value = e.toFixed(1);
    $('#tr-dur').textContent = `Duração total: ${fmtSec(d)} · corte atual: ${(e - s).toFixed(1)}s`;
  };
  sIn.oninput = sync; eIn.oninput = sync;

  root.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => {
    const d = job.dur;
    if (b.dataset.p === '3f') { sIn.value = '0'; eIn.value = '3'; }
    else if (b.dataset.p === '5f') { sIn.value = '0'; eIn.value = '5'; }
    else { sIn.value = Math.max(0, d - 5).toFixed(1); eIn.value = d.toFixed(1); }
    sync();
  }; });

  runBtn.onclick = async () => {
    if (busy || !job) return; busy = true; runBtn.disabled = true; prog.hidden = false; bar.style.width = '2%';
    $('#tr-res').innerHTML = '';
    try {
      const out = await processVideo(job.file, { start: +sIn.value, end: +eIn.value, w: job.w, h: job.h, bitrate: 4_000_000 },
        (p) => { bar.style.width = Math.round(2 + p * 98) + '%'; });
      showVideoResult($('#tr-res'), { blob: out.blob, name: outName(job.file, '-corte'), ext: out.ext, sizeNote: `Corte: ${(+eIn.value - +sIn.value).toFixed(1)}s` });
      toast('Corte pronto!', 'ok');
    } catch (e) { toast(e.message, 'err'); }
    finally { busy = false; runBtn.disabled = false; }
  };
  return {};
}
