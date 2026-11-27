// ============================================================
// Tool 2 — Legenda (texto posicionado) e Marca d'água (tilé diagonal)
// Mantém as dimensões originais da imagem — pronto pra subir no anúncio
// ============================================================
import { loadImage, download } from '../lib/canvas.js';

const MAX_BYTES = 25 * 1024 * 1024, OUT_CAP = 2160;
const POS = { bl: 'baixo-esq', bc: 'baixo-centro', br: 'baixo-dir', tl: 'topo-esq', tc: 'topo-centro', tr: 'topo-dir' };

export function initWatermark(root, { toast }) {
  const state = {
    kind: 'legenda',
    text: 'SEU TEXTO AQUI',
    pos: 'bc', sizePct: 3.4, color: '#ffffff', opacity: 0.95, bar: true,
    wm: 'MINHA MARCA', wmOpacity: 0.16, wmSizePct: 2.6, angle: -45,
  };
  let job = null; // {img,w,h,url,file}

  root.innerHTML = `
  <section class="card">
    <h2>Legenda &amp; marca d’água</h2>
    <p class="sub">Texto na posição certa pra retenção de atenção — ou sua marca repetida contra print solto.</p>
    <div class="drop" id="wm-drop">🖼️ <b>Arraste a imagem aqui</b> ou clique para escolher<input type="file" id="wm-input" accept="image/*" hidden>
    </div>
    <div class="row" style="margin-top:14px">
      <div class="opts" id="wm-kind">
        <button class="opt is-on" data-k="legenda">Legenda</button>
        <button class="opt" data-k="marca">Marca d’água</button>
      </div>
    </div>
    <div class="row" id="wm-leg">
      <label class="fld grow">Texto da legenda <input type="text" id="wm-text" maxlength="80" value="${state.text}"></label>
      <label class="fld">Posição
        <select id="wm-pos">${Object.entries(POS).map(([k, v]) => `<option value="${k}" ${k === state.pos ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </label>
      <label class="fld">Tamanho <span id="wm-sizev">3.4%</span><input type="range" id="wm-size" min="1.2" max="8" step="0.1" value="3.4"></label>
      <label class="fld">Cor <input type="color" id="wm-color" value="#ffffff"></label>
      <label class="fld" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="wm-bar" checked style="accent-color:var(--acc)"> Faixa de fundo</label>
    </div>
    <div class="row" id="wm-marca" hidden>
      <label class="fld grow">Texto da marca <input type="text" id="wm-wm" maxlength="40" value="${state.wm}"></label>
      <label class="fld">Opacidade <span id="wm-opv">16%</span><input type="range" id="wm-op" min="4" max="60" step="1" value="16"></label>
      <label class="fld">Tamanho <span id="wm-wmsizev">2.6%</span><input type="range" id="wm-wmsize" min="1" max="6" step="0.1" value="2.6"></label>
      <label class="fld">Ângulo <span id="wm-angv">-45°</span><input type="range" id="wm-angle" min="-90" max="90" step="5" value="-45"></label>
    </div>
    <div class="row" style="margin-top:14px">
      <button class="btn acc" id="wm-dl-png" disabled>⬇ PNG</button>
      <button class="btn" id="wm-dl-jpg" disabled>⬇ JPG</button>
    </div>
    <div class="stage" id="wm-stage"><div class="placeholder">Sem imagem ainda — a prévia aparece aqui ao vivo.</div></div>
  </section>`;

  const $ = (s) => root.querySelector(s);
  const stage = $('#wm-stage'), drop = $('#wm-drop'), input = $('#wm-input');
  const pngBtn = $('#wm-dl-png'), jpgBtn = $('#wm-dl-jpg');

  // ---------- carregar imagem ----------
  drop.onclick = () => input.click();
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('Arquivo precisa ser imagem', 'err');
    if (f.size > MAX_BYTES) return toast('Imagem acima de 25 MB', 'err');
    try { job = await loadImage(f); job.file = f; } catch (e) { return toast(e.message, 'err'); }
    input.value = '';
    pngBtn.disabled = jpgBtn.disabled = false;
    render();
  };

  // ---------- controles ----------
  $('#wm-kind').addEventListener('click', (e) => {
    const b = e.target.closest('.opt'); if (!b) return;
    state.kind = b.dataset.k;
    document.querySelectorAll('#wm-kind .opt').forEach((o) => o.classList.toggle('is-on', o === b));
    $('#wm-leg').hidden = state.kind !== 'legenda';
    $('#wm-marca').hidden = state.kind !== 'marca';
    render();
  });
  $('#wm-text').oninput = (e) => { state.text = e.target.value; render(); };
  $('#wm-pos').onchange = (e) => { state.pos = e.target.value; render(); };
  $('#wm-size').oninput = (e) => { state.sizePct = +e.target.value; $('#wm-sizev').textContent = (+e.target.value).toFixed(1) + '%'; render(); };
  $('#wm-color').oninput = (e) => { state.color = e.target.value; render(); };
  $('#wm-bar').onchange = (e) => { state.bar = e.target.checked; render(); };
  $('#wm-wm').oninput = (e) => { state.wm = e.target.value; render(); };
  $('#wm-op').oninput = (e) => { state.wmOpacity = e.target.value / 100; $('#wm-opv').textContent = e.target.value + '%'; render(); };
  $('#wm-wmsize').oninput = (e) => { state.wmSizePct = +e.target.value; $('#wm-wmsizev').textContent = (+e.target.value).toFixed(1) + '%'; render(); };
  $('#wm-angle').oninput = (e) => { state.angle = +e.target.value; $('#wm-angv').textContent = e.target.value + '°'; render(); };

  // ---------- desenho ----------
  function render() {
    if (!job) return;
    stage.innerHTML = '';
    const cv = document.createElement('canvas');
    cv.width = job.w; cv.height = job.h;
    paint(cv.getContext('2d'), job.w, job.h);
    stage.appendChild(cv);
  }

  function paint(ctx, W, H) {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(job.img, 0, 0, W, H);
    const m = 0.03 * W; // margem padrão
    if (state.kind === 'legenda' && state.text.trim()) {
      const fs = Math.round((state.sizePct / 100) * W);
      ctx.font = `800 ${fs}px ui-sans-serif, system-ui, "Segoe UI", Roboto, Arial, sans-serif`;
      ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = state.opacity;
      const padX = fs * 0.55, padY = fs * 0.42;
      const tw = ctx.measureText(state.text).width;
      const bx = state.pos[1] === 'l' ? m : state.pos[1] === 'r' ? W - m - tw - padX * 2 : (W - tw - padX * 2) / 2;
      const by = state.pos[0] === 't' ? m + fs : H - m - padY; // baseline topo/baixo
      if (state.bar) {
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = '#000';
        roundRect(ctx, bx, by - fs - padY, tw + padX * 2, fs + padY * 2, fs * 0.28);
        ctx.fill();
      }
      ctx.globalAlpha = state.opacity;
      ctx.fillStyle = state.color;
      // sombra leve p/ legibilidade sobre foto
      ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = fs * 0.18;
      ctx.fillText(state.text, bx + padX, by);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    } else if (state.kind === 'marca' && state.wm.trim()) {
      const fs = Math.round((state.wmSizePct / 100) * W);
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate((state.angle * Math.PI) / 180);
      ctx.font = `800 ${fs}px ui-sans-serif, system-ui, "Segoe UI", Roboto, Arial, sans-serif`;
      ctx.globalAlpha = state.wmOpacity;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      const tw = ctx.measureText(state.wm).width;
      const stepX = tw + fs * 2.2, stepY = fs * 4.2;
      const diag = Math.hypot(W, H);
      for (let y = -diag; y <= diag; y += stepY) {
        for (let x = -diag; x <= diag; x += stepX) {
          ctx.fillText(state.wm, x + ((Math.round(y / stepY) % 2) * stepX) / 2, y); // linha entrelaçada
        }
      }
      ctx.restore();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function dl(type) {
    if (!job) return;
    const scale = Math.min(1, OUT_CAP / Math.max(job.w, job.h));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(job.w * scale));
    cv.height = Math.max(1, Math.round(job.h * scale));
    paint(cv.getContext('2d'), cv.width, cv.height);
    download(cv, `${job.file.name.replace(/\.[^.]+$/, '')}_editado`, type, 0.92);
    toast('Editado salvo', 'ok');
  }
  pngBtn.onclick = () => dl('image/png');
  jpgBtn.onclick = () => dl('image/jpeg');

  return { destroy() { if (job) URL.revokeObjectURL(job.url); } };
}
