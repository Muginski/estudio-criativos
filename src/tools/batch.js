// ============================================================
// Tool — Lote: mesmo processamento em vários vídeos → 1 ZIP
// Paridade com "lote" do Rateio Hot, sem upload (eles: 5 arquivos,
// 33 MB cada, TTL 24h no servidor; aqui tudo fica no aparelho).
// ============================================================
import { slug } from '../lib/canvas.js';
import { processVideo, probeVideo, parseCaptions, VIDEO_LIMITS, fmtBytes } from '../lib/video.js';
import { makeZip, downloadBlob } from '../lib/zip.js';
import { bindDrop, checkVideo, isImageFile, outName } from '../lib/vtool.js';

const FORMATS = [
  { id: 'auto', n: 'Auto', wh: null }, { id: '916', n: '9:16', wh: { w: 1080, h: 1920 } },
  { id: '45', n: '4:5', wh: { w: 1080, h: 1350 } }, { id: '11', n: '1:1', wh: { w: 1080, h: 1080 } },
  { id: '169', n: '16:9', wh: { w: 1920, h: 1080 } },
];

export function initBatch(root, { toast }) {
  root.innerHTML = `
  <section class="card gated">
    <h2>Lote <span class="badge-pro">PRO</span></h2>
    <p class="sub">O mesmo tratamento em vários vídeos de uma vez — formato, marca e legenda iguais em todos. Sai um único ZIP pronto pra subir.</p>
    <div class="drop" id="bt-drop">🎬 <b>Arraste até 5 vídeos aqui</b> ou clique para escolher<input type="file" id="bt-input" accept="video/*" multiple hidden>
      <small>até 5 arquivos · 33 MB e 180 s cada</small></div>
    <div id="bt-list" class="klist"></div>
    <div class="row" style="margin-top:14px;gap:14px;flex-wrap:wrap">
      <label class="fld grow"><span>Formato (todos)</span>
        <select id="bt-fmt">${FORMATS.map((f) => `<option value="${f.id}"${f.id === 'auto' ? ' selected' : ''}>${f.n}</option>`).join('')}</select></label>
      <div style="flex:1;min-width:220px">
        <div class="drop sm2" id="bt-imgdrop">🖼️ <b>Cobertura p/ todos</b> <small>(opcional)</small></div>
      </div>
    </div>
    <input type="file" id="bt-imginput" accept="image/*" hidden>
    <label class="fld" style="margin-top:12px"><span>Marca/legenda queimada em todos (texto simples, opcional)</span>
      <input type="text" id="bt-wm" maxlength="40" placeholder="Ex.: @seuperfil"></label>
    <label class="fld" style="margin-top:10px"><span>Legendas SRT usadas em todos (opcional)</span>
      <textarea id="bt-srt" placeholder="Cole um SRT…" style="min-height:70px;font-family:ui-monospace,Consolas,monospace;font-size:12px"></textarea></label>
    <div class="row" style="margin-top:14px"><button class="btn acc" id="bt-run" disabled>📦 Processar lote</button></div>
    <div class="prog" id="bt-prog" hidden><i></i></div>
    <p class="note" id="bt-status" style="margin-top:8px"></p>
    <div id="bt-res"></div>
  </section>`;

  const $ = (s) => root.querySelector(s);
  let jobs = [], imgFile = null, busy = false;

  bindDrop(root, $('#bt-drop'), $('#bt-input'), (files) => {
    const rest = [];
    for (const f of files) {
      if (jobs.length >= VIDEO_LIMITS.files) { toast(`Máximo ${VIDEO_LIMITS.files} vídeos por lote`, 'err'); break; }
      const err = checkVideo(f); if (err) { toast(`${f.name}: ${err}`, 'err'); continue; }
      rest.push({ file: f });
    }
    jobs = [...jobs, ...rest]; renderList();
  });

  const imgDrop = $('#bt-imgdrop');
  let imgInput = $('#bt-imginput');
  const pickImg = ([f]) => {
    if (!f || !isImageFile(f)) return toast('Escolha uma imagem', 'err');
    imgFile = f;
    imgDrop.innerHTML = `🖼️ <b>${f.name}</b><small>(cobertura aplicada a todos · clique p/ trocar)</small>`;
    bindDrop(root, imgDrop, imgInput, pickImg); // re-liga p/ trocar de imagem
    toast('Cobertura pronta', 'ok');
  };
  bindDrop(root, imgDrop, imgInput, pickImg);

  function renderList() {
    const list = $('#bt-list');
    list.innerHTML = jobs.map((j, i) =>
      `<div class="krow">🎬 <span class="knm">${j.file.name}</span><span class="fdet">${j.st || fmtBytes(j.file.size)}</span>
       <button class="btn sm ghost" data-rm="${i}">remover</button></div>`).join('');
    list.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { jobs.splice(+b.dataset.rm, 1); renderList(); });
    $('#bt-run').disabled = !jobs.length || busy;
  }

  $('#bt-run').onclick = async () => {
    if (busy || !jobs.length) return;
    busy = true; $('#bt-run').disabled = true;
    $('#bt-prog').hidden = false; $('#bt-res').innerHTML = '';
    try {
      // valida duração de tudo antes de começar
      for (const j of jobs) {
        const m = await probeVideo(j.file); j.meta = m;
        if (m.dur > VIDEO_LIMITS.sec + 0.5) throw new Error(`"${j.file.name}" passa de 180 s`);
      }
      const fmt = FORMATS.find((x) => x.id === $('#bt-fmt').value);
      const wmTxt = $('#bt-wm').value.trim();
      const caps = parseCaptions($('#bt-srt').value);
      const zipFiles = [];
      for (let i = 0; i < jobs.length; i++) {
        const j = jobs[i];
        $('#bt-status').textContent = `Processando ${i + 1}/${jobs.length} — ${j.file.name}`;
        j.st = 'processando…'; renderList();
        const out = await processVideo(j.file, {
          ...(fmt.wh || {}),
          ...(imgFile ? { overlayImage: imgFile, overlay: { fadeAt: 1, fadeDur: 1.2, finalOp: 0.06 } } : {}),
          ...(wmTxt ? { wm: { kind: 'legend', text: wmTxt, pos: 'bc', sizePct: 3.4, color: '#fff', opacity: 0.95, bar: true } } : {}),
          ...(caps.length ? { captions: caps, cap: { sizePct: 4.5, pos: 'b', color: '#fff' } } : {}),
          perturb: !!imgFile,
          bitrate: 2_800_000,
        }, (p) => { $('#bt-prog').querySelector('i').style.width = Math.round(((i + p) / jobs.length) * 100) + '%'; });
        zipFiles.push({ name: `${slug(outName(j.file, i === 0 ? '' : '-v' + (i + 1)))}.${out.ext}`, data: new Uint8Array(await out.blob.arrayBuffer()) });
        j.st = `pronto · ${fmtBytes(out.blob.size)}`; renderList();
      }
      const zip = makeZip(zipFiles);
      downloadBlob(zip, 'estudio-criativos-lote.zip');
      $('#bt-status').textContent = `Lote concluído — ${zipFiles.length} vídeos · ZIP de ${fmtBytes(zip.size)}`;
      $('#bt-res').innerHTML = `<div class="vidres"><a class="btn acc" href="${URL.createObjectURL(zip)}" download="estudio-criativos-lote.zip" id="bt-zipagain">⬇ Baixar ZIP novamente (${fmtBytes(zip.size)})</a></div>`;
      setTimeout(() => { const a = $('#bt-zipagain'); if (a) URL.revokeObjectURL(a.href); }, 60000);
      toast('Lote pronto!', 'ok');
    } catch (e) { toast(e.message, 'err'); }
    finally { busy = false; $('#bt-run').disabled = !jobs.length; $('#bt-status').textContent ||= ''; }
  };
  return {};
}
