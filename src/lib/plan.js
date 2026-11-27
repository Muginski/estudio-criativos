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
  if (isPro()) { S.usage.prints += 1; save(S); syncUsage(); return true; }
  if (S.usage.prints >= FREE_DAILY.prints) return false;
  S.usage.prints += 1; save(S); syncUsage();
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

// ---------- Espelho Supabase free (opcional; ativo se VITE_SUPABASE_URL/ANON_KEY) ----------
const SB_URL = import.meta.env?.VITE_SUPABASE_URL;
const SB_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY;
const sbHeaders = () => ({ apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' });

function deviceId() {
  let id = localStorage.getItem('ec_device_v1');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('ec_device_v1', id); }
  return id;
}

/** Espelha o uso de hoje no Supabase (upsert). Falha silenciosa. */
export async function syncUsage() {
  if (!SB_URL || !SB_KEY) return;
  try {
    await fetch(`${SB_URL}/rest/v1/usage?on_conflict=device_id,day`, {
      method: 'POST',
      headers: { ...sbHeaders(), Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ device_id: deviceId(), day: S.usage.date, prints: S.usage.prints }),
    });
  } catch { /* offline */ }
}

/** Restaura o maior uso do dia vindo do servidor (bloqueia reset de localStorage). */
export async function restoreUsage() {
  if (!SB_URL || !SB_KEY) return;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/usage?device_id=eq.${encodeURIComponent(deviceId())}&day=eq.${S.usage.date}&select=prints`, { headers: sbHeaders() });
    const [row] = await r.json();
    if (row && row.prints > S.usage.prints) { S.usage.prints = row.prints; save(S); }
  } catch { /* offline */ }
}

/** Ativa Pro via RPC activate(codigo) no Supabase. */
export async function activateRemote(code) {
  const c = String(code || '').trim().toUpperCase();
  if (c.length < 6) return { ok: false, err: 'Código muito curto.' };
  if (!SB_URL || !SB_KEY) return activatePro(c);
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/activate`, {
      method: 'POST', headers: sbHeaders(),
      body: JSON.stringify({ codigo: c, p_device: deviceId() }),
    });
    if (!r.ok) return { ok: false, err: 'Código inválido ou já usado.' };
    S.pro = { active: true, until: Date.parse(await r.json()) }; save(S);
    return { ok: true };
  } catch { return { ok: false, err: 'Sem conexão.' }; }
}
