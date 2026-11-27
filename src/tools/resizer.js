// ============================================================
// Tool 1 — Redimensionar criativos para formatos de anúncio
// (referência rateiohot.com: "redimensionar" era vídeo-first;
//  aqui foca imagem, que é o uso real de quem roda tráfego)
// ============================================================
import { RATIOS, loadImage, drawCover, drawContained, download, slug } from '../lib/canvas.js';

// ---- zip mínimo (sem compressão, "store") ----
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function makeZip(files) { // files: [{name, data:Uint8Array}]
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true); lh.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(lh.buffer), nm, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, sz, true); ch.setUint32(24, sz, true); ch.setUint16(28, nm.length, true);
    ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nm);
    off += 30 + nm.length + sz;
  }
  const csize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, csize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

const MAX_FILES = 10, MAX_BYTES = 25 * 1024 * 1024, PREVIEW_SIDE = 420;

export function initResizer(root, { toast }) {
  const state = { ratio: '9:16', mode: 'blur', color: '#10131a', out: 'image/png' };
  const jobs = []; // {file, img, w, h, url}

  root.innerHTML = `
  <section class="card">
    <h2>Redimensionar criativos</h2>
    <p class="sub">Exporte no tamanho exato do destino — sem esticar, sem surpresa no anúncio.</p>
    <div class="drop" id="rz-drop">📁 <b>Arraste imagens aqui</b> ou clique para escolher<br><small>até ${MAX_FILES} imagens · 25 MB cada · JPG/PNG/WebP</small>
      <input type="file" id="rz-input" accept="image/*" multiple hidden>
    </div>
    <div class="row" style="margin-top:14px"><div class="opts" id="rz-ratios"></div></div>
    <div class="row">
      <label class="fld">Fundo quando não fechar o formato
        <select id="rz-mode">
          <option value="blur">Fundo desfocado (padrão)</option>
          <option value="cover">Recorte central (sem fundo)</option>
          <option value="solid">Cor sólida</option>
        </select>
      </label>
      <label class="fld" id="rz-colorwrap" hidden>Cor <input type="color" id="rz-color" value="${state.color}"></label>
      <label class="fld">Saída
        <select id="rz-type">
          <option value="image/png">PNG (fiel)</option>
          <option value="image/jpeg">JPG (mais leve)</option>
        </select>
      </label>
    </div>
    <div class="row" style="margin-top:14px">
      <button class="btn acc" id="rz-all" disabled>⬇ Baixar tudo</button>
      <button class="btn" id="rz-zip" disabled>📦 Baixar ZIP (formatos selecionados)</button>
      <span id="rz-count" style="color:var(--mut);font-size:12.5px"></span>
    </div>
    <div class="previews" id="rz-grid"></div>
  </section>`;

  const $ = (s) => root.querySelector(s);
  const drop = $('#rz-drop'), input = $('#rz-input'), grid = $('#rz-grid'), allBtn = $('#rz-all'), zipBtn = $('#rz-zip');
  const ratiosEl = $('#rz-ratios'), modeSel = $('#rz-mode'), colorIn = $('#rz-color'), typeSel = $('#rz-type'), countEl = $('#rz-count');

  // ---------- chips de formato ----------
  for (const [key, r] of Object.entries(RATIOS)) {
    const b = document.createElement('button');
    b.className = 'opt' + (key === state.ratio ? ' is-on' : '');
    b.dataset.r = key;
    b.innerHTML = `${key}<small>${r.w}×${r.h} · ${r.label}</small>`;
    b.onclick = () => {
      state.ratio = key;
      ratiosEl.querySelectorAll('.opt').forEach((o) => o.classList.toggle('is-on', o === b));
      renderPreviews();
    };
    ratiosEl.appendChild(b);
  }

  // ---------- controles ----------
  modeSel.onchange = () => { $('#rz-colorwrap').hidden = modeSel.value !== 'solid'; renderPreviews(); };
  colorIn.oninput = () => { state.color = colorIn.value; renderPreviews(); };
  typeSel.onchange = () => { state.out = typeSel.value; };

  drop.onclick = () => input.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); };
  input.onchange = () => addFiles(input.files);

  allBtn.onclick = async () => {
    for (let i = 0; i < jobs.length; i++) {
      const j = jobs[i];
      await exportOne(j);
      await new Promise((r) => setTimeout(r, 350)); // evita bloqueio de downloads em sequência
    }
  };

  zipBtn.onclick = async () => {
    const files = [];
    for (const j of jobs) {
      for (const key of j.formats) {
        const { w, h } = RATIOS[key];
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        paint(cv.getContext('2d'), j, w, h);
        const blob = await new Promise((ok) => cv.toBlob(ok, state.out, 0.92));
        if (!blob) continue;
        const ext = state.out === 'image/jpeg' ? 'jpg' : 'png';
        files.push({ name: `${slug(j.file.name, key)}.${ext}`, data: new Uint8Array(await blob.arrayBuffer()) });
      }
    }
    if (!files.length) { toast('Selecione ao menos um formato', 'err'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(makeZip(files));
    a.download = 'criativos.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`ZIP com ${files.length} arquivos`, 'ok');
  };

  async function addFiles(list) {
    for (const f of [...list]) {
      if (jobs.length >= MAX_FILES) { toast(`Máximo de ${MAX_FILES} imagens por vez`, 'err'); break; }
      if (!f.type.startsWith('image/')) continue;
      if (f.size > MAX_BYTES) { toast('Imagem acima de 25 MB pulada', 'err'); continue; }
      try {
        const L = await loadImage(f);
        jobs.push({ ...L, file: f, formats: new Set([state.ratio]) });
      } catch (e) { toast(e.message, 'err'); }
    }
    input.value = '';
    renderPreviews();
  }

  // ---------- desenho (preview pequeno / full no download) ----------
  function paint(ctx, j, tw, th) {
    const r = RATIOS[state.ratio];
    void r; // alvo já vem dimensionado
    if (state.mode === 'cover') drawCover(ctx, j.img, j.w, j.h, tw, th);
    else drawContained(ctx, j.img, j.w, j.h, tw, th, state.mode === 'solid' ? 'solid' : 'blur', state.color);
  }

  function renderPreviews() {
    grid.innerHTML = '';
    countEl.textContent = jobs.length ? `${jobs.length}/${MAX_FILES} imagens` : '';
    allBtn.disabled = zipBtn.disabled = !jobs.length;
    const tw = RATIOS[state.ratio].w, th = RATIOS[state.ratio].h;
    const s = PREVIEW_SIDE / Math.max(tw, th);
    for (const j of jobs) {
      const pv = document.createElement('div');
      pv.className = 'pv';
      const cvWrap = document.createElement('div'); cvWrap.className = 'pv-cv';
      const cv = document.createElement('canvas');
      cv.width = Math.round(tw * s); cv.height = Math.round(th * s);
      paint(cv.getContext('2d'), j, cv.width, cv.height);
      cvWrap.appendChild(cv);
      const bar = document.createElement('div'); bar.className = 'pv-bar';
      const nm = document.createElement('span'); nm.textContent = j.file.name; nm.title = j.file.name;
      const b = document.createElement('button'); b.className = 'btn sm ghost'; b.textContent = '⬇';
      b.title = 'Baixar esta'; b.onclick = () => exportOne(j);
      bar.append(nm, b);
      const fm = document.createElement('div'); fm.className = 'pv-bar'; fm.style.flexWrap = 'wrap';
      for (const key of Object.keys(RATIOS)) {
        const lb = document.createElement('label'); lb.style.fontSize = '12px'; lb.style.marginRight = '8px';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = j.formats.has(key);
        cb.onchange = () => { if (cb.checked) j.formats.add(key); else j.formats.delete(key); };
        lb.append(cb, ' ' + key);
        fm.appendChild(lb);
      }
      pv.append(cvWrap, bar, fm);
      grid.appendChild(pv);
    }
  }

  async function exportOne(j) {
    const { w: tw, h: th } = RATIOS[state.ratio];
    const cv = document.createElement('canvas');
    cv.width = tw; cv.height = th;
    paint(cv.getContext('2d'), j, tw, th);
    const name = slug(j.file.name, state.ratio);
    download(cv, name, state.out);
    toast('Gerado ' + name, 'ok');
  }

  renderPreviews();

  return {
    destroy() { jobs.forEach((j) => URL.revokeObjectURL(j.url)); },
  };
}
