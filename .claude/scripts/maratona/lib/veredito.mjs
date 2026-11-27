// Aplica o resultado de uma tentativa ao estado: aprovação (idempotente), falha, espera pela sessão limpa e bloqueios.
// Só roda depois do veredito do runner. A aprovação grava o `passes` por último, depois que o código já está commitado.
// Todo efeito gravado carrega o id do journal (ledger, folha, progresso): o replay depois de uma queda não duplica nada.
import fs from 'node:fs';
import path from 'node:path';
import { ErroEstado, linhaDiario, hoje } from './estado.mjs';
import { registrar } from './custos.mjs';
import { registrarFolha } from './prova.mjs';
import { decidir } from './roteador.mjs';
import { commitarEstado, codigoIgual } from './repo.mjs';
import { carregarLista, salvarLista, atualizarFeature } from './lista.mjs';
import { apagarJournal } from './execucao.mjs';
import { descartarCommit } from './turno.mjs';
import { limites, soma, agoraIso, tocarRegistro } from './registro.mjs';
import { fecharMaratona, portoesPendentes } from './portaoFinal.mjs';

const resumirAchados = achados => (achados ?? []).slice(0, 5).map(a => String(a).slice(0, 1500));
const aplicar = (c, id, mudar) => salvarLista(c.repo, atualizarFeature(carregarLista(c.repo).lista, id, mudar));
const marca = id => (id ? `<!-- ${id} -->` : '');
const jaTem = (arquivo, id) => Boolean(id) && fs.existsSync(arquivo) && fs.readFileSync(arquivo, 'utf8').includes(marca(id));

// Identidade durável do evento: <journal.id>:<etapa>:<índice>. Sem journal (testes antigos) grava como antes.
export function gravarCustos(repo, eventos, journalId, diaDoJournal) {
  eventos.forEach((e, i) => registrar(repo, journalId ? { ...(diaDoJournal && !e.dia ? { dia: diaDoJournal } : {}), ...e, idEvento: `${journalId}:${e.etapa}:${i}` } : e));
}

export function progresso(repo, titulo, linhas, journalId) {
  const arquivo = path.join(repo, '.maratona', 'progresso.md');
  if (jaTem(arquivo, journalId)) return;
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.appendFileSync(arquivo, `\n## ${titulo} — ${agoraIso()}\n${marca(journalId)}\n${linhas.map(l => `- ${l}`).join('\n')}\n`);
}

export function folha(repo, texto, journalId) {
  if (jaTem(path.join(repo, '.maratona', 'folha-de-provas.md'), journalId)) return;
  registrarFolha(repo, `${marca(journalId)}\n${texto}`);
}

// O total do registro global é derivado da lista (nunca incrementado): reexecutar não diverge.
export function atualizarRegistro(c) {
  const lista = carregarLista(c.repo).lista;
  const total = lista.features.reduce((s, f) => s + (f.custo_usd ?? 0), 0) + (lista.custo_plano_usd ?? 0);
  tocarRegistro(c.nome, () => ({ custo_total_usd: total }));
  return { feitas: lista.features.filter(f => f.estado === 'aprovada').length, total: lista.features.length };
}

// Maratona parada: o watchdog não a retoma; sai com `fim`/`parar` ou quando o dono resolve e apaga o journal.
export function pararMaratona(c, motivo) {
  tocarRegistro(c.nome, () => ({ status: 'parada', motivo_parada: motivo }));
  linhaDiario(`Maratona "${c.nome}" PARADA em ${c.repo}: ${motivo}`);
  c.saida(`[${c.nome}] PARADA: ${motivo}`);
}

// Commit de registro (só .maratona, sem hook) e conferência dura: o código tem de continuar idêntico ao commit provado.
function fecharComCommitDeEstado(c, feature, commit, mensagem) {
  commitarEstado(c.repo, mensagem);
  if (!commit || codigoIgual(c.repo, commit, 'HEAD')) return;
  const motivo = `o código mudou depois do commit provado ${String(commit).slice(0, 7)} (hook de commit?); aprovação recusada, journal preservado`;
  aplicar(c, feature.id, f => ({ ...f, estado: 'bloqueada', passes: false, motivo: `${motivo}` }));
  pararMaratona(c, `${feature.id}: ${motivo}`);
  throw new ErroEstado(`Código alterado depois do commit provado (${feature.id}).`);
}

// Chamado pelo turno depois do commit do código e da conferência da árvore. Ordem: custos, folha, progresso, lista (ponto de
// confirmação) e, por fim, o commit do estado. Se cair no meio, o journal 'commitado' faz a retomada terminar o que faltou.
export function gravarAprovacao(c, feature, n, modelo, tipo = 'feature') {
  return async ({ commit, custos, folha: textoFolha, baseVermelha, journalId, journalDia, coberta, adiados }) => {
    const gasto = soma(custos);
    gravarCustos(c.repo, [...custos, { featureId: feature.id, etapa: 'aprovacao', modelo, custoUsd: 0, aprovado: true, tentativa: n, ...(coberta ? { coberta: true } : {}) }], journalId, journalDia);
    folha(c.repo, `Feature ${feature.id} ${coberta ? 'COBERTA' : 'APROVADA'} (tentativa ${n}, ${modelo})\n${textoFolha}`, journalId);
    progresso(c.repo, `Tentativa ${n} — ${feature.id} (${modelo}) — ${coberta ? 'COBERTA' : 'APROVADA'}`, [textoFolha], journalId);
    const tentativa = { n, em: agoraIso(), modelo, tipo: 'ok', resultado: coberta ? 'coberta' : 'aprovada', custoUsd: gasto };
    aplicar(c, feature.id, f => ({ ...f, estado: 'aprovada', passes: true, aguardando: undefined, achados: undefined, proximo_modelo: undefined,
      motivo: undefined, custo_usd: f.custo_usd + gasto, tentativas: [...f.tentativas, tentativa],
      ...(coberta ? { coberta_por: commit } : {}), adiados: adiados?.length ? adiados : undefined, ...(baseVermelha && !f.base_vermelha ? { base_vermelha: baseVermelha } : {}),
      histo: [...f.histo, `${hoje()}: ${coberta ? 'coberta' : 'aprovada'} (${modelo}, US$ ${gasto.toFixed(4)})`] }));
    fecharComCommitDeEstado(c, feature, commit, mensagemRegistro(feature, tipo, coberta));
  };
}

export const mensagemRegistro = (feature, tipo, coberta) => (coberta ? `chore(${feature.id}): coberta por commits anteriores`
  : tipo === 'prova' ? `chore(${feature.id}): sessão limpa aprovada` : `chore(${feature.id}): registro da aprovação`);

// Retomada de feature que já estava aprovada na lista: só falta o commit de registro e o contador global.
export async function terminarRegistro(c, feature, commit) {
  fecharComCommitDeEstado(c, feature, commit, mensagemRegistro(feature, 'feature', false));
  await concluirSeTudoFeito(c);
}

async function concluirSeTudoFeito(c) {
  const { feitas, total } = atualizarRegistro(c);
  if (feitas !== total) return false;
  return (await fecharMaratona(c, { concluida: true })).status === 'concluida';
}

export async function aprovada(c, feature, modelo, res) {
  const gasto = soma(res.custos);
  const { feitas, total } = atualizarRegistro(c);
  const rotulo = res.resultado === 'coberta' ? 'coberta' : 'aprovada';
  linhaDiario(`${feature.id} ${rotulo} em ${c.repo}: "${feature.titulo}" (${modelo}, commit ${String(res.commit).slice(0, 7)}, US$ ${gasto.toFixed(4)}; ${feitas}/${total} features).`);
  c.saida(`[${c.nome}] ${feature.id} ${rotulo} (${modelo}, commit ${String(res.commit).slice(0, 7)}, US$ ${gasto.toFixed(4)}).`);
  if (feitas === total) {
    const fim = await fecharMaratona(c, { concluida: true });
    if (fim.status === 'concluida') linhaDiario(`Maratona "${c.nome}" CONCLUÍDA: ${feitas}/${total} features aprovadas em ${c.repo}.`);
    return { parar: true };
  }
  return { parar: false };
}

// Saída de aguardando_prova para bloqueio: patch + revert do commit guardado antes de liberar a fila. Se o revert falhar, a
// feature continua aguardando (fila parada) com o motivo. Feature coberta não tem commit próprio: nada a desfazer.
export function sairDaEspera(c, feature, guardado, motivo) {
  const curto = String(motivo).replace(/\.$/, '');
  if (guardado.coberta) return { estado: 'bloqueada', bloqueios: feature.bloqueios + 1, aguardando: undefined, motivo: `${curto}; nada a desfazer (coberta por commits anteriores)` };
  try {
    const patch = descartarCommit({ ...c, feature }, guardado.base, guardado.commit);
    return { estado: 'bloqueada', bloqueios: feature.bloqueios + 1, aguardando: undefined, motivo: `${curto}; trabalho desfeito (patch ${path.basename(patch)})` };
  } catch (e) {
    return { estado: 'aguardando_prova', aguardando: { ...guardado, proxima_em: new Date(Date.now() + limites().esperaProvaMin * 60000).toISOString() },
      motivo: `${curto}; não foi possível desfazer o commit guardado: ${e.message}`.slice(0, 400) };
  }
}

function estadoAposAguardando(c, feature, res) {
  // Pré-checagens (teto, código mudado) não são tentativa de prova: não contam para o máximo.
  const conta = !res.semContar && !res.motivo, lim = limites();
  const tp = (feature.aguardando?.tentativas_prova ?? 0) + (conta ? 1 : 0);
  const guardado = { base: res.base, commit: res.commit, desde: feature.aguardando?.desde ?? agoraIso(), tentativas_prova: tp,
    provas: res.provas ?? feature.aguardando?.provas ?? [], ...(res.coberta || feature.aguardando?.coberta ? { coberta: true } : {}) };
  if (conta && tp >= lim.maxProva) return sairDaEspera(c, feature, guardado, `sessão limpa indisponível em ${tp} tentativas`);
  return { estado: 'aguardando_prova', motivo: res.motivo,
    aguardando: { ...guardado, proxima_em: new Date(Date.now() + lim.esperaProvaMin * 60000).toISOString() } };
}

const ultimoRelato = (feature, tentativa) => [...feature.tentativas, tentativa].reverse().find(t => t.relato)?.relato;

function estadoAposFalha(feature, tentativa, res) {
  if (tentativa.tipo === 'parada') return { estado: 'pendente', passes: false, motivo: res.erro };
  const infra = feature.tentativas.filter(t => t.tipo === 'infra').length + 1;
  const d = tentativa.tipo === 'infra' && infra >= limites().maxInfra
    ? { acao: 'bloquear', modelo: tentativa.modelo, motivo: `Infraestrutura falhou ${infra} vezes.` }
    : decidir(feature, tentativa);
  if (d.acao === 'bloquear') {
    const relato = ultimoRelato(feature, tentativa);
    return { estado: 'bloqueada', bloqueios: feature.bloqueios + 1, aguardando: undefined,
      motivo: relato ? `${d.motivo} Último relato do modelo: ${relato}` : d.motivo };
  }
  return { estado: 'pendente', aguardando: undefined, proximo_modelo: d.modelo, ...(res.tipo === 'infra' ? {} : { achados: resumirAchados(res.achados) }) };
}

function diarioFalha(c, feature, res, novo) {
  if (novo.estado === 'bloqueada') linhaDiario(`${feature.id} bloqueada em ${c.repo}: ${novo.motivo}.${portoesPendentes(c, feature).map(t => ` ${t}.`).join('')}`);
  else if (res.resultado === 'infra') linhaDiario(`Falha de infra em ${c.repo} (${feature.id}): ${String(res.erro ?? res.cortadoPor).slice(0, 160)}.`);
  else if (res.motivo && res.motivo !== feature.motivo) linhaDiario(`${feature.id} aguarda em ${c.repo}: ${res.motivo}.`);
  else if (res.resultado === 'aguardando' && !feature.aguardando) linhaDiario(`Sessão limpa indisponível em ${c.repo}: ${feature.id} aguarda prova (commit ${String(res.commit).slice(0, 7)}).`);
}

export function falhou(c, feature, n, modelo, res) {
  const gasto = soma(res.custos);
  gravarCustos(c.repo, res.custos, res.journalId, res.journalDia);
  if (res.folha) folha(c.repo, `Feature ${feature.id} ${res.resultado.toUpperCase()} (tentativa ${n}, ${modelo}, ${res.tipo ?? '-'})\n${res.folha}`, res.journalId);
  const espera = res.resultado === 'aguardando';
  const tentativa = { n, em: agoraIso(), modelo, tipo: espera ? 'indisponivel' : res.tipo, resultado: res.resultado, custoUsd: gasto,
    ...(espera ? { infra: true } : {}), ...(res.erro ? { erro: String(res.erro).slice(0, 400) } : {}),
    ...(res.cortadoPor ? { cortadoPor: res.cortadoPor } : {}), ...(res.patch ? { patch: res.patch } : {}), ...(res.relato ? { relato: res.relato } : {}),
    ...(res.provas_passaram === true ? { provas_passaram: true } : {}) };
  const novo = espera ? estadoAposAguardando(c, feature, res) : estadoAposFalha(feature, tentativa, res);
  aplicar(c, feature.id, f => ({ ...f, ...novo, ...(res.baseVermelha && !f.base_vermelha ? { base_vermelha: res.baseVermelha } : {}),
    custo_usd: f.custo_usd + gasto, tentativas: [...f.tentativas, tentativa] }));
  progresso(c.repo, `Tentativa ${n} — ${feature.id} (${modelo}) — ${res.resultado}`, [`tipo: ${tentativa.tipo}`, `custo: US$ ${gasto.toFixed(4)}`, ...String(res.folha ?? '').split('\n').filter(l => l.startsWith('adiado:')), ...resumirAchados(res.achados).map(a => a.split('\n')[0])], res.journalId);
  atualizarRegistro(c);
  diarioFalha(c, feature, res, novo);
  c.saida(`[${c.nome}] ${feature.id} t${n} ${modelo} → ${res.resultado}${res.tipo ? ` (${res.tipo})` : ''}; próximo: ${novo.estado}${novo.proximo_modelo ? ` ${novo.proximo_modelo}` : ''}.`);
  return { parar: res.resultado === 'infra' || espera };
}

export const marcarBaseVermelha = (c, id, base) => aplicar(c, id, f => ({ ...f, base_vermelha: base }));

// Prova que já passa na base: a feature é bloqueada sem chamar o modelo.
export function bloquearProvaVerde(c, feature) {
  const motivo = 'prova já passa na base: a verificação não prova a feature (use refatoracao:true se o pedido é não mudar comportamento)';
  aplicar(c, feature.id, f => ({ ...f, estado: 'bloqueada', bloqueios: f.bloqueios + 1, motivo }));
  linhaDiario(`${feature.id} bloqueada em ${c.repo}: ${motivo}.`);
  c.saida(`[${c.nome}] ${feature.id} bloqueada: ${motivo}.`);
  return { rodou: false, parar: false };
}

// Teto atingido: feature em espera é desfeita com patch e revert; feature pendente só é bloqueada.
export function bloquearPorTeto(c, feature, motivo) {
  const novo = feature.estado === 'aguardando_prova' && feature.aguardando
    ? sairDaEspera(c, feature, feature.aguardando, motivo)
    : { estado: 'bloqueada', bloqueios: feature.bloqueios + 1, motivo };
  aplicar(c, feature.id, f => ({ ...f, ...novo }));
  linhaDiario(`${feature.id} ${novo.estado === 'bloqueada' ? 'bloqueada' : 'segue aguardando'} em ${c.repo}: ${novo.motivo}.`);
}

// Fecha a tentativa no estado e só então apaga o journal: uma queda antes disso é reconciliada no próximo disparo.
export async function resultado(c, feature, n, modelo, res) {
  if (res.resultado === 'guarda') { c.saida(`[${c.nome}] ${res.motivo}`); return { parar: true, rodou: false }; }
  if (res.resultado === 'prova-verde') return bloquearProvaVerde(c, feature);
  const fim = ['aprovada', 'coberta'].includes(res.resultado) ? await aprovada(c, feature, modelo, res) : falhou(c, feature, n, modelo, res);
  apagarJournal(c.nome);
  return { rodou: true, ...fim };
}
