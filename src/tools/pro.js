// ============================================================
// Tool 5 — Plano Pro (R$ 29,90 / 30 dias, PIX one-shot, sem recorrência)
// MVP zero-custo: gera "Pix copia-e-cola" EMV no cliente (chave vinda do .env)
// Pendência paga (opcional): gateway automático (Asaas/MercadoPago) c/ webhook
// ============================================================
import { isPro, proUntil, activatePro, todayUsage } from '../lib/plan.js';

const PRICE = (import.meta.env.VITE_PRECO_PRO || '29.90').toString().replace(',', '.');
const CHAVE = import.meta.env.VITE_PIX_CHAVE || '';
const NOME = import.meta.env.VITE_PIX_NOME || 'Estudio de Criativos';
const CIDADE = import.meta.env.VITE_PIX_CIDADE || 'SAO PAULO';

/** CRC16/CCITT-FALSE — obrigatório no payload Pix */
function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = (crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0);
    crc &= 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Monta o payload Pix estático (copia-e-cola) */
function emvPix({ chave, nome, cidade, valor }) {
  const f = (id, v) => `${id}${String(v).length.toString().padStart(2, '0')}${v}`;
  const ma = f('00', 'br.gov.bcb.pix') + f('01', chave); // merchant account info
  let p =
    f('00', '01') + f('01', '12') +
    f('26', ma) +
    f('52', '0000') + f('53', '986') +
    f('54', valor) +
    f('58', 'BR') + f('59', nome.slice(0, 25)) + f('60', cidade.slice(0, 15).toUpperCase()) +
    f('62', f('05', '***'));
  return p + '6304' + crc16(p + '6304');
}

export function initPro(root, { toast, renderChip }) {
  const payload = CHAVE ? emvPix({ chave: CHAVE, nome: NOME, cidade: CIDADE, valor: PRICE }) : '';
  const until = isPro() ? new Date(proUntil()).toLocaleDateString('pt-BR') : null;

  root.innerHTML = `
  <div class="pro-grid">
    <section class="card">
      <h2>Estúdio Pro <span class="badge-pro">R$ ${PRICE.replace('.', ',')} / 30 dias</span></h2>
      <p class="sub">Pagamento único via Pix. Sem mensalidade escondida, sem recorrência automática — renova só se quiser, na mão.</p>
      <ul class="ticks">
        <li><b>Discrição total</b>: tudo roda no seu aparelho — nada é enviado a servidor nenhum</li>
        <li>Print → Texto <b>ilimitado</b> (grátis é 5/dia)</li>
        <li>Lote: edite e baixe várias imagens de uma vez</li>
        <li>Ferramentas de vídeo (legendas automáticas e corte) incluídas</li>
        <li>Suporte direto pelo WhatsApp pra dúvidas de criativo</li>
      </ul>
      <div class="row" style="margin-top:18px">
        ${until ? `<div style="color:var(--ok);font-weight:700">✔ Você está no Pro até ${until}</div>` : ''}
        <label class="fld grow" style="margin-left:auto">Código de ativação
          <input type="text" id="pr-code" placeholder="EC-XXXXXX" autocomplete="off">
        </label>
        <button class="btn acc" id="pr-activate">Ativar</button>
      </div>
      <div id="pr-note" hidden style="margin-top:10px;color:var(--ok);font-size:13px;font-weight:600">Pro ativado por 30 dias. Bom trabalho! 🚀</div>
    </section>

    <section class="card">
      <h2>Pagar via Pix</h2>
      <p class="sub">Fluxo simples, sem cadastro: pague, me mande o comprovante e receba seu código de ativação.</p>
      ${payload ? `
        <ol class="steps">
          <li>Copie o <b>Pix copia-e-cola</b> abaixo (${PRICE.replace('.', ',')} reais)</li>
          <li>Pague no app do seu banco (expira em 30 min)</li>
          <li>Mande o comprovante no WhatsApp do suporte → recebe seu código <b>EC-XXXXXX</b></li>
        </ol>
        <div class="copybox" id="pr-payload" style="margin-top:14px">${payload}</div>
        <div class="row" style="margin-top:10px">
          <button class="btn" id="pr-copy">⧉ Copiar Pix</button>
        </div>`
      : `
        <div class="card" style="background:var(--bg-3);font-size:13.5px;color:var(--mut)">
          ⏳ Chave Pix ainda não configurada no <code>.env</code> (<b>VITE_PIX_CHAVE</b>).<br>
          Assim que a chave entrar, o copia-e-cola aparece aqui na hora — o app já está pronto.
        </div>`}
    </section>
  </div>`;

  const $ = (s) => root.querySelector(s);
  const actBtn = $('#pr-activate');
  if (actBtn) actBtn.onclick = () => {
    const r = activatePro($('#pr-code').value);
    if (!r.ok) return toast(r.err, 'err');
    renderChip();
    actBtn.disabled = true;
    $('#pr-code').disabled = true;
    $('#pr-note').hidden = false;
    toast('Pro ativado!', 'ok');
  };
  const cp = $('#pr-copy');
  if (cp) cp.onclick = async () => {
    try { await navigator.clipboard.writeText(payload); toast('Pix copiado — cola no banco', 'ok'); }
    catch { toast('Não deu pra copiar — selecione manualmente', 'err'); }
  };

  void todayUsage; // usado só no chip global
  return {};
}
