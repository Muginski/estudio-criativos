// ============================================================
// Tool — Comprimir vídeo · 100% no navegador
// Paridade com "comprimir" do Rateio Hot: mesmo conteúdo, menos MB —
// com o comparativo antes/depois na tela.
// ============================================================
import { processVideo, probeVideo, showVideoResult, fmtBytes, fmtSec } from '../lib/video.js';
import { bindDrop, checkVideo, fileLine, outName } from '../lib/vtool.js';

const TARGETS = [
  { id: 'tiny', n: 'Pequeno (~0.9 Mbps)', bps: 900_000, small: 'prévia / story rascunho' },
  { id: 'eco', n: 'Econômico (~1.5 Mbps)', bps: 1_500_000, small: 'feed, bom custo-benefício' },
  { id: 'mid', n: 'Equilibrado (~2.5 Mbps)', bps: 2_500_000, small: 'padrão pra anúncio' },
  { id: 'high', n: 'Alta (~5 Mbps)', bps: 5_000_000, small: 'quase sem perda' },
];

export function initCompress(root, { toast }) {
  root.innerHTML = `
  <section class="card gated">
    <h2>Comprimir vídeo <span class="badge-pro">PRO</span></h2>
    <p class="sub">Menos MB com a mesma cara — pronto pra subir onde o limite de upload apertar. O comparativo sai na hora.</p>
    <div class="drop" id="cc-drop">🎬 <b>Arraste o vídeo aqui</b> ou clique para escolher<input type="file" id="cc-input" accept="video/*" hidden>
      <small>MP4/MOV/WebM · 33 MB máx · 180 s máx</small></div>
    <div class="row" style="margin-top:14px">
      <label class="fld grow"><span>Nível de compressão</span>
        <select id="cc-tgt">${TARGETS.map((t) => `<option value="${t.id}"${t.id === 'mid' ? ' selected' : ''}>${t.n} — ${t.small}</option>`).join('')}</select></label>
    </div>
    <div class="row" style="margin-top:14px"><button class="btn acc" id="cc-run" disabled>🗜 Comprimir</button></div>
    <div class="prog" id="cc-prog" hidden><i></i></div>
    <div id="cc-res"></div>
  </section>`;

  const $ = (s) => root.querySelector(s);
  let job = null, busy = false;

  bindDrop(root, $('#cc-drop'), $('#cc-input'), async ([f]) => {
    const err = checkVideo(f); if (err) return toast(err, 'err');
    try {
      const meta = await probeVideo(f);
      job = { file: f, ...meta };
      $('#cc-drop').innerHTML = fileLine(f.name, `${meta.w}×${meta.h} · ${fmtSec(meta.dur)} · ${fmtBytes(f.size)}`);
      $('#cc-drop').classList.add('hasfile');
      $('#cc-run').disabled = false;
    } catch { toast('Não foi possível ler o vídeo', 'err'); }
  });

  $('#cc-run').onclick = async () => {
    if (busy || !job) return; busy = true; $('#cc-run').disabled = true;
    $('#cc-prog').hidden = false; $('#cc-prog i').style.width = '2%'; $('#cc-res').innerHTML = '';
    try {
      const t = TARGETS.find((x) => x.id === $('#cc-tgt').value);
      const out = await processVideo(job.file, { w: job.w & ~1, h: job.h & ~1, bitrate: t.bps },
        (p) => { $('#cc-prog i').style.width = Math.round(2 + p * 98) + '%'; });
      const drop = ((job.file.size - out.blob.size) / job.file.size) * 100;
      showVideoResult($('#cc-res'), {
        blob: out.blob, name: outName(job.file, `-min-${t.id}`), ext: out.ext,
        sizeNote: `Antes: ${fmtBytes(job.file.size)} → depois: ${fmtBytes(out.blob.size)} ${drop > 0 ? `(−${drop.toFixed(0)}%)` : '(já estava compacto)'}`,
      });
      toast(drop > 0 ? `Pronto — economizou ${drop.toFixed(0)}%` : 'Pronto', 'ok');
    } catch (e) { toast(e.message, 'err'); }
    finally { busy = false; $('#cc-run').disabled = false; }
  };
  return {};
}
