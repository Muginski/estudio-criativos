// ============================================================
// Tool — Redimensionar/converter vídeo · 100% no navegador
// Paridade com "redimensionar" do Rateio Hot (vídeo-first):
// troca o formato pra outra rede sem regravar na mão.
// ============================================================
import { processVideo, probeVideo, showVideoResult, targetSize, fmtBytes, fmtSec } from '../lib/video.js';
import { bindDrop, checkVideo, fileLine, outName } from '../lib/vtool.js';

const FORMATS = [
  { id: 'auto', n: 'Auto (recomendado)', small: 'mantém formato, escala até 1440', wh: null },
  { id: '916', n: '9:16', small: 'Stories · Reels · TikTok', wh: { w: 1080, h: 1920 } },
  { id: '45', n: '4:5', small: 'Feed Instagram/Facebook', wh: { w: 1080, h: 1350 } },
  { id: '11', n: '1:1', small: 'Feed quadrado', wh: { w: 1080, h: 1080 } },
  { id: '34', n: '3:4', small: 'Feed retrato', wh: { w: 1080, h: 1440 } },
  { id: '169', n: '16:9', small: 'YouTube · capa · web', wh: { w: 1920, h: 1080 } },
];
const FITS = [
  { id: 'cover', n: 'Preencher (corta as bordas)' },
  { id: 'blur', n: 'Completar (fundo borrado)' },
  { id: 'black', n: 'Completar (fundo preto)' },
];

export function initVresize(root, { toast }) {
  root.innerHTML = `
  <section class="card gated">
    <h2>Redimensionar vídeo <span class="badge-pro">PRO</span></h2>
    <p class="sub">Um vídeo gravado em um formato, pronto pra todas as redes. Roda no aparelho — nada vai pro servidor.</p>
    <div class="drop" id="vr-drop">🎬 <b>Arraste o vídeo aqui</b> ou clique para escolher<input type="file" id="vr-input" accept="video/*" hidden>
      <small>MP4/MOV/WebM · 33 MB máx · 180 s máx</small></div>
    <div class="row" style="margin-top:14px" id="vr-opts">
      <label class="fld grow"><span>Formato de saída</span>
        <select id="vr-fmt">${FORMATS.map((f) => `<option value="${f.id}">${f.n} — ${f.small}</option>`).join('')}</select></label>
      <label class="fld grow"><span>Como encaixar</span>
        <select id="vr-fit">${FITS.map((f) => `<option value="${f.id}"${f.id === 'cover' ? ' selected' : ''}>${f.n}</option>`).join('')}</select></label>
    </div>
    <div class="row" style="margin-top:14px"><button class="btn acc" id="vr-run" disabled>⤢ Converter</button></div>
    <div class="prog" id="vr-prog" hidden><i></i></div>
    <div id="vr-res"></div>
  </section>`;

  const $ = (s) => root.querySelector(s);
  const drop = $('#vr-drop'), input = $('#vr-input'), runBtn = $('#vr-run'), prog = $('#vr-prog'), bar = prog.querySelector('i');
  let job = null, busy = false;

  bindDrop(root, drop, input, async ([f]) => {
    const err = checkVideo(f); if (err) return toast(err, 'err');
    try {
      const meta = await probeVideo(f);
      job = { file: f, ...meta };
      drop.innerHTML = fileLine(f.name, `${meta.w}×${meta.h} · ${fmtSec(meta.dur)} · ${fmtBytes(f.size)}`);
      drop.classList.add('hasfile');
      runBtn.disabled = false;
      toast('Vídeo carregado', 'ok');
    } catch { toast('Não foi possível ler o vídeo', 'err'); }
  });

  runBtn.onclick = async () => {
    if (busy || !job) return; busy = true; runBtn.disabled = true; prog.hidden = false; bar.style.width = '2%';
    $('#vr-res').innerHTML = '';
    try {
      const fmt = FORMATS.find((x) => x.id === $('#vr-fmt').value);
      const fit = $('#vr-fit').value;
      const opts = { fit: fit === 'cover' ? 'cover' : 'contain', bg: fit === 'black' ? 'solid' : 'blur', bgColor: '#000' };
      if (fmt.wh) { opts.w = fmt.wh.w; opts.h = fmt.wh.h; }
      const out = await processVideo(job.file, opts, (p) => { bar.style.width = Math.round(2 + p * 98) + '%'; });
      showVideoResult($('#vr-res'), { blob: out.blob, name: outName(job.file, fmt.id === 'auto' ? '' : '-' + fmt.id.replace(':', 'x')), ext: out.ext, sizeNote: `Saída: ${out.w}×${out.h}` });
      toast('Conversão pronta!', 'ok');
    } catch (e) { toast(e.message, 'err'); }
    finally { busy = false; runBtn.disabled = false; }
  };
  return {};
}
