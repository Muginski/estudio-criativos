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

// ---------- montagem de tools ----------
const TOOLS = {
  resizer: initResizer,
  watermark: initWatermark,
  ocr: initOcr,
  fonts: initFonts,
  pro: initPro,
};
const api = { toast, plan, renderChip };
let current = null;
let currentTab = 'resizer';

function mount(tab) {
  const view = document.getElementById('view');
  if (current) current.destroy();
  view.innerHTML = '';
  currentTab = tab;
  current = TOOLS[tab](view, api) || {};
  window.dispatchEvent(new CustomEvent('ec:tab', { detail: tab }));
}

// ---------- navegação ----------
document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t === btn));
  mount(btn.dataset.tab);
});

renderChip();
mount('resizer');
