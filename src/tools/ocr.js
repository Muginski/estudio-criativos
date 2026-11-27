// ============================================================
// Tool 3 — Print → Texto (OCR tesseract.js WASM, roda no navegador)
// Gargalo grátis: 5 prints/dia (lib/plan.js) → funil pro Pro
// ============================================================
import Tesseract from 'tesseract.js';

let worker = null;
async function getWorker(onProgress) {
  if (!worker) {
    worker = await Tesseract.createWorker('por+eng', 1, {
      logger: (m) => { if (m.status === 'recognizing text') onProgress(m.progress || 0); },
    });
  }
  return worker;
}

const MAX_BYTES = 20 * 1024 * 1024;

export function initOcr(root, { toast, plan, renderChip }) {
  let busy = false, job = null; // {img,url,file}

  root.innerHTML = `
  <section class="card">
    <div class="row" style="justify-content:space-between">
      <div>
        <h2>Print → Texto <span class="badge-free" id="ocr-left"></span></h2>
        <p class="sub">Transforme screenshot/ print de copy em texto editável. OCR roda no seu aparelho — nada vai pro servidor.</p>
      </div>
    </div>
    <div class="drop" id="oc-drop">📸 <b>Arraste o print aqui</b> ou clique para escolher<br><small>JPG/PNG · 20 MB máx · melhor resultado com texto nítido</small>
      <input type="file" id="oc-input" accept="image/*" hidden>
    </div>
    <div class="row" style="margin-top:14px">
      <button class="btn acc" id="oc-run" disabled>✨ Extrair texto (PT + EN)</button>
      <span id="oc-status" style="color:var(--mut);font-size:12.5px"></span>
    </div>
    <div class="prog" id="oc-prog" hidden><i></i></div>
    <div id="oc-outwrap" hidden>
      <div class="row" style="margin-top:16px;justify-content:space-between">
        <strong style="font-size:13px;color:var(--mut)">TEXTO EXTRAÍDO</strong>
        <button class="btn sm" id="oc-copy">⧉ Copiar</button>
      </div>
      <textarea id="oc-out" style="min-height:180px;margin-top:8px;font-size:13.5px" spellcheck="false"></textarea>
    </div>
    <div id="oc-lock" hidden style="margin-top:14px">
      <div class="card" style="background:var(--bg-3)">
        <div class="row" style="justify-content:space-between">
          <div><b>Limite grátis esgotado</b><div style="color:var(--mut);font-size:13px;margin-top:4px">Você usou os 5 prints de hoje. Renova amanhã — ou desbloqueia tudo com o Pro.</div></div>
          <button class="btn acc" id="oc-unlock">Ver Pro · R$ 29,90</button>
        </div>
      </div>
    </div>
  </section>`;

  const $ = (s) => root.querySelector(s);
  const drop = $('#oc-drop'), input = $('#oc-input'), runBtn = $('#oc-run');
  const status = $('#oc-status'), prog = $('#oc-prog'), progBar = prog.querySelector('i');
  const outWrap = $('#oc-outwrap'), outTa = $('#oc-out'), leftEl = $('#ocr-left'), lockEl = $('#oc-lock');

  function refreshLeft() {
    if (plan.isPro()) { leftEl.textContent = 'PRO · ilimitado'; leftEl.className = 'badge-pro'; lockEl.hidden = true; }
    else {
      const { used, left } = plan.todayUsage();
      leftEl.textContent = `${used}/5 hoje`;
      leftEl.className = 'badge-free';
      if (left <= 0) lockEl.hidden = false;
    }
  }
  refreshLeft();

  drop.onclick = () => !busy && input.click();
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('Arquivo precisa ser imagem', 'err');
    if (f.size > MAX_BYTES) return toast('Print acima de 20 MB', 'err');
    if (job) URL.revokeObjectURL(job.url);
    try {
      const url = URL.createObjectURL(f);
      const img = new Image();
      await new Promise((ok, fail) => { img.onload = ok; img.onerror = () => fail(new Error('Falha ao ler imagem')); img.src = url; });
      job = { img, url, file: f };
      outWrap.hidden = true;
      runBtn.disabled = false;
    } catch (e) { toast(e.message, 'err'); }
    input.value = '';
  };

  $('#oc-unlock').onclick = () => document.getElementById('sec-pro')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  runBtn.onclick = async () => {
    if (!job || busy) return;
    if (!plan.isPro()) {
      const { left } = plan.todayUsage();
      if (left <= 0) { refreshLeft(); return toast('Limite diário atingido — veja o Pro', 'err'); }
    }
    busy = true;
    runBtn.disabled = true;
    prog.hidden = false; progBar.style.width = '2%';
    status.textContent = 'Carregando modelo (1ª vez demora um pouco)…';
    try {
      const w = await getWorker((p) => { progBar.style.width = Math.round(4 + p * 96) + '%'; status.textContent = `Lendo texto… ${Math.round(p * 100)}%`; });
      const { data } = await w.recognize(job.img);
      if (!plan.isPro() && !plan.bumpPrint()) { refreshLeft(); return toast('Limite diário atingido exatamente agora 😅', 'err'); }
      outTa.value = (data.text || '').trim();
      outWrap.hidden = false;
      refreshLeft();
      renderChip && renderChip();
      toast('Texto extraído!', 'ok');
    } catch (e) {
      toast('Falha no OCR: ' + (e.message || e), 'err');
    } finally {
      busy = false;
      runBtn.disabled = !job;
      prog.hidden = true;
      status.textContent = '';
    }
  };

  $('#oc-copy').onclick = async () => {
    outTa.select();
    try { await navigator.clipboard.writeText(outTa.value); toast('Copiado!', 'ok'); }
    catch { document.execCommand('copy'); toast('Copiado!', 'ok'); }
  };

  return { destroy() { if (job) URL.revokeObjectURL(job.url); } };
}
