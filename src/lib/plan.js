// ============================================================
// Estado de plano + uso diário (localStorage)
// MVP sem servidor: o contador vive no aparelho do usuário.
// Pendência (back): espelhar no banco para impedir reset de localStorage
// e liberar Pro via webhook do pagamento.
// ============================================================

const LS_KEY = 'ec_state_v1';
/** Limite grátis por dia (decisão de produto: fontes ilimitadas + 5 prints/dia) */
export const FREE_DAILY = { prints: 5 };

const day = () => new Date().toISOString().slice(0, 10);

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY));
    if (s && typeof s === 'object') return s;
  } catch { /* estado corrompido → zera */ }
  return { pro: { active: false, until: 0 }, usage: { date: day(), prints: 0 } };
}
function save(s) { localStorage.setItem(LS_KEY, JSON.stringify(s)); }

let S = load();
if (S.usage.date !== day()) { S.usage = { date: day(), prints: 0 }; save(S); }

export function isPro() { return S.pro.active && Date.now() < S.pro.until; }
export function proUntil() { return S.pro.until; }

/** Uso de hoje: já usado + restante */
export function todayUsage() {
  const used = S.usage.prints;
  return { used, left: Math.max(0, FREE_DAILY.prints - used) };
}

/** Registra 1 uso de print. Retorna true se coube no limite (ou Pro) */
export function bumpPrint() {
  if (isPro()) { S.usage.prints += 1; save(S); return true; }
  if (S.usage.prints >= FREE_DAILY.prints) return false;
  S.usage.prints += 1; save(S);
  return true;
}

/** Ativação manual do Pro (código gerado pelo dono após confirmar Pix) — 30 dias */
export function activatePro(code) {
  const c = String(code || '').trim().toUpperCase();
  if (c.length < 6) return { ok: false, err: 'Código muito curto.' };
  S.pro = { active: true, until: Date.now() + 30 * 86400000 };
  save(S);
  return { ok: true };
}

export function refreshState() { S = load(); }
