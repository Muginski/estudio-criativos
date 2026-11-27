// ============================================================
// Núcleo do app: shell, abas, toast e estado de plano
// ============================================================
import './styles.css';
import * as plan from './lib/plan.js';
import { initResizer } from './tools/resizer.js';
import { initWatermark } from './tools/watermark.js';
import { initOcr } from './tools/ocr.js';
import { initFonts } from './tools/fonts.js';
import { initPro } from './tools/pro.js';

// ---------- toast ----------
let toastTimer = null;
export function toast(msg, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
}

// ---------- plano (chip no topo) ----------
function renderChip() {
  const el = document.getElementById('plan-chip');
  const usage = plan.todayUsage();
  if (plan.isPro()) {
    const d = new Date(plan.proUntil());
    el.textContent = `PRO ativo até ${d.toLocaleDateString('pt-BR')}`;
    el.classList.add('pro');
  } else {
    el.textContent = `Grátis · ${usage.left}/5 prints hoje`;
    el.classList.remove('pro');
  }
}
window.__ecRenderChip = renderChip; // usado pelos tools após mudar estado

// ---------- montagem: tudo em UMA PÁGINA (sem abas) ----------
const ORDER = ['resizer', 'watermark', 'ocr', 'fonts', 'pro'];
const TOOLS = {
  resizer: initResizer,
  watermark: initWatermark,
  ocr: initOcr,
  fonts: initFonts,
  pro: initPro,
};
const api = { toast, plan, renderChip };
const view = document.getElementById('view');

for (const name of ORDER) {
  const wrap = document.createElement('section');
  wrap.className = 'tool';
  wrap.id = 'sec-' + name;
  view.appendChild(wrap);
  TOOLS[name](wrap, api) || {};
}

// deep link por hash (#resizer, #watermark, #ocr, #fonts, #pro)
function scrollToHash() {
  const t = (location.hash || '').slice(1);
  const el = t && document.getElementById('sec-' + t);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.addEventListener('hashchange', scrollToHash);
window.addEventListener('load', scrollToHash);

renderChip();
