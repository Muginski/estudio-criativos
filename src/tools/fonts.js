// ============================================================
// Tool 4 — Fontes para copy (Unicode) — grátis e ilimitada (isca)
// Conversão por mapa de código Unicode (math alphanumerics + combining)
// ============================================================

// bases por estilo: maiúscula, minúscula, dígito, whitelist de minúsculas (quando há furos no bloco)
const MAPS = {
  bold:         { u: 0x1d400, l: 0x1d41a, d: 0x1d7ce },
  italic:       { u: 0x1d434, l: 0x1d44e, d: null, lower: 'abdefghijklmnopqstuvwxyz' },
  script:       { u: 0x1d4d8, l: 0x1d4f8, d: null },
  boldscript:   { u: 0x1d4d0, l: 0x1d4ee, d: null },
  fraktur:      { u: 0x1d504, l: 0x1d51e, d: null },
  boldfraktur:  { u: 0x1d56c, l: 0x1d586, d: null },
  dblstruck:    { u: 0x1d538, l: 0x1d552, d: 0x1d7d8, lower: 'acdfgkmnrt' },
  sans:         { u: 0x1d5a0, l: 0x1d5ba, d: 0x1d7e2 },
  boldsans:     { u: 0x1d5ec, l: 0x1d5fe, d: 0x1d7ea },
  mono:         { u: 0x2c60,  l: 0x2c78,  d: 0x1d7ee },
  boldmono:     { u: 0x1d670, l: 0x1d682, d: 0x1d7f6 },
};

const STYLES = [
  { id: 'bold', n: 'Negrito', m: MAPS.bold },
  { id: 'italic', n: 'Itálico', m: MAPS.italic },
  { id: 'fraktur', n: 'Serif decorado', m: MAPS.fraktur },
  { id: 'boldfraktur', n: 'Serif decorado negrito', m: MAPS.boldfraktur },
  { id: 'script', n: 'Script', m: MAPS.script },
  { id: 'boldscript', n: 'Script negrito', m: MAPS.boldscript },
  { id: 'dbls', n: 'Duplo traço', m: MAPS.dblstruck },
  { id: 'sans', n: 'Sans-serif', m: MAPS.sans },
  { id: 'boldsans', n: 'Sans negrito', m: MAPS.boldsans },
  { id: 'mono', n: 'Mono', m: MAPS.mono },
  { id: 'boldmono', n: 'Mono negrito', m: MAPS.boldmono },
  { id: 'circled', n: 'Circulado' },
  { id: 'squared', n: 'Quadrado' },
  { id: 'smallcaps', n: 'Small caps' },
  { id: 'fullwidth', n: 'Fullwidth' },
  { id: 'underline', n: 'Sublinhado' },
  { id: 'strike', n: 'Riscado' },
  { id: 'overline', n: 'Superlinhado' },
  { id: 'cloak', n: 'Cloaker invisível ✦' },
];

function mapByTable(s, m) {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    const isU = c >= 0x41 && c <= 0x5a, isL = c >= 0x61 && c <= 0x7a, isD = c >= 0x30 && c <= 0x39;
    if (isU && m.u) out += String.fromCodePoint(m.u + c - 0x41);
    else if (isL && m.l && (!m.lower || m.lower.includes(ch))) out += String.fromCodePoint(m.l + c - 0x61);
    else if (isD && m.d) out += String.fromCodePoint(m.d + c - 0x30);
    else out += ch; // pontuação/acento ficam como estão
  }
  return out;
}

const COMBINE = { underline: '\u0332', strike: '\u0336', overline: '\u0305' };

// Cloaker de Texto: insere marcadores de zero-largura entre os caracteres.
// Visual idêntico, bytes diferentes → o criativo muda no hash da rede.
// Semente por clique = cada geração sai diferente.
function cloakInvisible(text, seed) {
  let h = 2166136261 >>> 0;
  const feed = (s) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } };
  feed(text); feed(String(seed || ''));
  let rnd = h || 1, out = '';
  for (const ch of [...text]) {
    rnd = (Math.imul(rnd ^ (ch.codePointAt(0) + 0x9e3779b9), 16777619)) >>> 0;
    out += ch;
    if (ch !== ' ') out += rnd % 3 === 0 ? '\u200d' : '\u200b'; // joiner ou space zerados
  }
  return out;
}

function convert(text, style, seed) {
  if (style.m) return mapByTable(text, style.m);
  switch (style.id) {
    case 'circled':
      return [...text].map((ch) => {
        const c = ch.codePointAt(0);
        if (c >= 0x41 && c <= 0x5a) return String.fromCodePoint(0x24b6 + c - 0x41);
        if (c >= 0x61 && c <= 0x7a) return String.fromCodePoint(0x24d0 + c - 0x61);
        return ch;
      }).join('');
    case 'squared':
      return [...text].map((ch) => {
        const c = ch.codePointAt(0);
        return c >= 0x41 && c <= 0x5a ? String.fromCodePoint(0x1f130 + c - 0x41) : ch;
      }).join('');
    case 'smallcaps':
      return [...text].map((ch) => {
        const c = ch.codePointAt(0);
        return c >= 0x61 && c <= 0x7a ? String.fromCodePoint(0x1d00 + c - 0x61) : ch;
      }).join('');
    case 'fullwidth':
      return [...text].map((ch) => {
        const c = ch.codePointAt(0);
        return c >= 0x21 && c <= 0x7e ? String.fromCodePoint(c + 0xfe00) : ch;
      }).join('');
    default: {
      if (style.id === 'cloak') return cloakInvisible(text, seed);
      const cm = COMBINE[style.id];
      return cm ? [...text].map((ch) => (ch === ' ' ? ch : ch + cm)).join('') : text;
    }
  }
}

export function initFonts(root, { toast }) {
  root.innerHTML = `
  <section class="card">
    <div class="row" style="justify-content:space-between">
      <div>
        <h2>Fontes &amp; Cloaker de Texto <span class="badge-free">GRÁTIS · ILIMITADO</span></h2>
        <p class="sub">Cole sua copy e toque num estilo — 18 estilos Unicode mais o cloaker invisível (o texto fica visualmente igual com bytes diferentes, cada clique gera variação nova). Cola direto na legenda.</p>
      </div>
    </div>
    <label class="fld grow"><span> Sua copy</span><textarea id="ft-in" placeholder="Ex.: O método que dobrou minha audiência em 14 dias…" style="min-height:110px"></textarea></label>
    <div class="opts" id="ft-styles" style="margin-top:12px"></div>
    <div id="ft-outwrap" hidden>
      <div class="row" style="margin-top:16px;justify-content:space-between">
        <strong style="font-size:13px;color:var(--mut)">RESULTADO — copie de lá</strong>
        <div class="row">
          <button class="btn sm" id="ft-copy">⧉ Copiar</button>
          <button class="btn sm ghost" id="ft-all">Lista completa</button>
        </div>
      </div>
      <textarea id="ft-out" style="min-height:120px;margin-top:8px;font-size:15px" readonly spellcheck="false"></textarea>
      <div id="ft-list" class="copybox" hidden></div>
    </div>
  </section>`;

  const $ = (s) => root.querySelector(s);
  const inp = $('#ft-in'), outWrap = $('#ft-outwrap'), outTa = $('#ft-out'), listBox = $('#ft-list');
  const stylesEl = $('#ft-styles');
  let activeId = null;

  for (const st of STYLES) {
    const b = document.createElement('button');
    b.className = 'opt';
    b.textContent = st.n;
    b.dataset.id = st.id;
    b.onclick = () => {
      activeId = st.id;
      stylesEl.querySelectorAll('.opt').forEach((o) => o.classList.toggle('is-on', o === b));
      const src = inp.value.trim();
      if (!src) { toast('Cole sua copy primeiro', 'err'); return; }
      outTa.value = convert(src, st, st.id === 'cloak' ? Date.now().toString(36) + Math.random().toString(36).slice(2, 6) : '');
      listBox.textContent = '';
      outWrap.hidden = false;
      if (st.id === 'cloak') toast('Visual idêntico, bytes únicos — cada toque gera variação nova', 'ok');
    };
    stylesEl.appendChild(b);
  }

  $('#ft-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(outTa.value); toast('Copiado! Cola na legenda 💪', 'ok'); }
    catch { outTa.select(); document.execCommand('copy'); toast('Copiado!', 'ok'); }
  };

  // "lista completa" = todos os estilos separados (pra testar qual fica melhor)
  $('#ft-all').onclick = async () => {
    const src = inp.value.trim();
    if (!src) return toast('Cole sua copy primeiro', 'err');
    if (listBox.hidden) {
      listBox.textContent = STYLES.map((st) => `${st.n.toUpperCase()}\n${convert(src, st)}\n`).join('\n—\n\n');
      listBox.hidden = false;
    } else listBox.hidden = true;
    toast('Lista gerada — copie o que servir', 'ok');
  };

  return {};
}
