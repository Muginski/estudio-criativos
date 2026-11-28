// ============================================================
// Núcleo do app v2: home em grade de ferramentas (padrão
// rateiohot.com/ferramentas), navegação por ferramenta,
// portão PRO na suíte de vídeo e estado de plano.
// ============================================================
import './styles.css';
import * as plan from './lib/plan.js';
import { initResizer } from './tools/resizer.js';
import { initWatermark } from './tools/watermark.js';
import { initOcr } from './tools/ocr.js';
import { initFonts } from './tools/fonts.js';
import { initPro } from './tools/pro.js';
// --- suíte de vídeo (paridade com o Rateio Hot; toda a engine vive em lib/video.js) ---
import { initCloaker } from './tools/cloaker.js';
import { initClean } from './tools/clean.js';
import { initCaptions } from './tools/captions.js';
import { initCompress } from './tools/compress.js';
import { initAudio } from './tools/vaudio.js';
import { initVresize } from './tools/vresize.js';
import { initTrim } from './tools/vtrim.js';
import { initVM } from './tools/vm.js';
import { initPreview } from './tools/vpreview.js';
import { initBatch } from './tools/batch.js';

// ---------- toast ----------
let toastTimer = null;
export function toast(msg, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
}

// ---------- plano (chip no topo + portões PRO) ----------
function renderChip() {
  plan.refreshState(); // re Lê do localStorage (ativou em outra aba/tool?)
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
  applyGates();
}
window.__ecRenderChip = renderChip; // usado pelos tools após mudar estado

// ---------- catálogo de ferramentas ----------
// Ordem espelha a do Rateio Hot (print, fontes, texto, variacoes,
// limpar, legendas, comprimir, extrair, redimensionar, lote,
// cortar, marca, previa, audio). tag: free | pro | plan
const TOOLS = [
  { id: 'ocr', ico: '🧾', t: 'Print → Texto', d: 'Transforma screenshot de copy em texto editável. OCR PT+EN no aparelho.', tag: 'free', tn: 'Grátis · 5/dia', init: initOcr },
  { id: 'fonts', ico: 'Ａ', t: 'Fontes & Cloaker de Texto', d: '18 estilos Unicode + marca invisível. O visual segue igual, os bytes não.', tag: 'free', tn: 'Grátis · ilimitado', init: initFonts },
  { id: 'resizer', ico: '🖼️', t: 'Redimensionar imagem', d: '9:16 · 4:5 · 1:1 · 16:9 nos tamanhos exatos de anúncio.', tag: 'free', tn: 'Grátis', init: initResizer },
  { id: 'watermark', ico: '✍️', t: 'Legenda & marca (imagem)', d: 'Texto em 6 posições com faixa · marca em tilé diagonal.', tag: 'free', tn: 'Grátis', init: initWatermark },
  { id: 'cloaker', ico: '🕶️', t: 'Cloaker de criativo', d: 'Hash 100% único + imagem por cima com fade + extensão só com a imagem.', tag: 'pro', tn: 'PRO', init: initCloaker },
  { id: 'clean', ico: '🧼', t: 'Limpar metadados', d: 'Tira localização, data e aparelho de imagem, vídeo e áudio.', tag: 'pro', tn: 'PRO', init: initClean },
  { id: 'captions', ico: '💬', t: 'Legendas', d: 'Cola um SRT (ou transcreve com Whisper) e queima letra grande no vídeo.', tag: 'pro', tn: 'PRO', init: initCaptions },
  { id: 'compress', ico: '🗜️', t: 'Comprimir vídeo', d: 'Menos MB com a mesma cara — comparativo antes/depois na hora.', tag: 'pro', tn: 'PRO', init: initCompress },
  { id: 'audio', ico: '🎧', t: 'Áudio', d: 'Extrai a trilha do vídeo ou sobrepõe a sua por cima com mixagem.', tag: 'pro', tn: 'PRO', init: initAudio },
  { id: 'vresize', ico: '⤢', t: 'Redimensionar vídeo', d: 'Um vídeo gravado num formato, pronto pra todas as redes.', tag: 'pro', tn: 'PRO', init: initVresize },
  { id: 'trim', ico: '✂️', t: 'Cortar vídeo', d: 'Corta início e fim sem perder qualidade percebida.', tag: 'pro', tn: 'PRO', init: initTrim },
  { id: 'vm', ico: '🔥', t: 'Marca em vídeo', d: 'Legenda ou tilé queimados no frame, com prévia ao vivo.', tag: 'pro', tn: 'PRO', init: initVM },
  { id: 'preview', ico: '👀', t: 'Gerador de preview', d: 'Borrão ou pixelado na parte quente — no todo ou só até X segundos.', tag: 'pro', tn: 'PRO', init: initPreview },
  { id: 'batch', ico: '📦', t: 'Lote', d: 'Mesmo tratamento em até 5 vídeos → um único ZIP pra subir.', tag: 'pro', tn: 'PRO', init: initBatch },
  { id: 'pro', ico: '⭐', t: 'Plano Pro', d: 'R$ 29,90 / 30 dias via Pix. Renovação manual, nunca recorrência automática.', tag: 'plan', tn: 'R$ 29,90', init: initPro },
];
const BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

// ---------- estado de navegação ----------
const api = { toast, plan, renderChip };
const view = document.getElementById('view');
let current = null;

function applyGates() {
  for (const t of TOOLS) {
    if (t.tag !== 'pro') continue;
    const sec = document.getElementById('sec-' + t.id);
    if (sec) sec.classList.toggle('locked', !plan.isPro());
  }
  // cards da home mostram cadeado no estado atual
  view.querySelectorAll('.tcard[data-t]').forEach((c) => c.classList.toggle('islocked', BY_ID[c.dataset.t]?.tag === 'pro' && !plan.isPro()));
}

function mount(t) {
  let sec = document.getElementById('sec-' + t.id);
  if (!sec) {
    sec = document.createElement('section');
    sec.className = 'tool';
    sec.id = 'sec-' + t.id;
    sec.hidden = true;
    view.appendChild(sec);
  }
  if (!sec.dataset.ready) {
    t.init(sec, api);
    if (t.tag === 'pro') {
      const g = document.createElement('div');
      g.className = 'gate';
      g.innerHTML = `<div class="gatebox"><span>🔒</span><div><b>Desbloqueada com o Pro</b><div class="gd">Esta é uma das ferramentas da suíte de vídeo — todas elas, ${fmtPrice()}, com renovação manual. Nada aqui sai do seu aparelho.</div></div><a class="btn acc sm" href="#pro">Ver plano</a></div>`;
      sec.prepend(g);
    }
    sec.dataset.ready = '1';
  }
  return sec;
}
function fmtPrice() { return 'R$ 29,90 / 30 dias'; }

function showHome(scroll = true) {
  current = null;
  view.querySelectorAll('.tool').forEach((s) => { s.hidden = true; });
  home.hidden = false;
  document.getElementById('nav-back').hidden = true;
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* file:// */ }
  if (scroll) window.scrollTo({ top: 0 });
}

function show(id, scroll = true) {
  const t = BY_ID[id];
  if (!t) return showHome(false);
  if (current === id) { if (scroll) window.scrollTo({ top: 0 }); return; }
  current = id;
  home.hidden = true;
  mount(t); // cria a seção ANTES do loop (seção nova nasce hidden=true)
  view.querySelectorAll('.tool').forEach((s) => { s.hidden = s.id !== 'sec-' + id; });
  applyGates();
  document.getElementById('nav-back').hidden = false;
  try { history.replaceState(null, '', location.pathname + location.search + '#' + id); } catch { /* file:// */ }
  window.scrollTo({ top: 0 });
}

// ---------- home (grade) ----------
const home = document.createElement('div');
home.className = 'home';
home.innerHTML = `
  <div class="hero">
    <h1>Ferramentas</h1>
    <p>A suíte de criativo completa pro nicho hot — imagem e vídeo. Grátis: fontes ilimitadas + 5 prints/dia. Suíte de vídeo: Pro, R$ 29,90/30 dias, Pix, renovação manual.</p>
  </div>
  <div class="tgrid">
    ${TOOLS.map((t) => `
      <button class="tcard" data-t="${t.id}">
        <span class="tico">${t.ico}</span>
        <span class="tt">${t.t}<i class="ttag ${t.tag === 'free' ? 'free' : t.tag}">${t.tn}</i></span>
        <span class="td">${t.d}</span>
      </button>`).join('')}
  </div>`;
view.prepend(home);
document.getElementById('nav-back').onclick = () => showHome();
home.querySelectorAll('.tcard').forEach((c) => { c.onclick = () => show(c.dataset.t, false); });

// ---------- deep link por hash (#cloaker, #pro, …) ----------
function routeFromHash() {
  const id = (location.hash || '').slice(1);
  if (BY_ID[id]) show(id, false); else showHome(false);
}
window.addEventListener('hashchange', routeFromHash);
window.addEventListener('load', () => { routeFromHash(); });
if ((location.hash || '').slice(1) in BY_ID) show((location.hash || '').slice(1), false); else showHome(false);

renderChip();
