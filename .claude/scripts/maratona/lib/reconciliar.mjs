// Retomada depois de queda: no início de cada disparo, com a trava na mão, o journal de uma execução que não fechou
// é reconciliado ANTES de olhar a lista. A branch maratona/<nome> é do runner: sujeira sem commit nela é da tentativa
// (patch + reset), mas commit alheio por cima nunca é desfeito. Qualquer dúvida de autoria para a maratona.
import path from 'node:path';
import { ErroEstado, linhaDiario } from './estado.mjs';
import { head, ramoAtual, arvoreDoHead, salvarPatch, reverter, codigoIgual, limparContaminacao } from './repo.mjs';
import { lerJournal, apagarJournal, listarJournals, avisarUmaVezPorDia } from './execucao.mjs';
import { carregarLista, salvarLista } from './lista.mjs';
import { gravarAprovacao, aprovada, falhou, gravarCustos, pararMaratona, terminarRegistro, atualizarRegistro } from './veredito.mjs';
import { soma, carregarRegistro, paradaSolicitada } from './registro.mjs';

// Custo da chamada que estava em andamento é desconhecido: conta a reserva, marcada como estimada (nunca zero).
const estimadoDaQueda = j => ({ featureId: j.featureId, etapa: 'queda', modelo: j.modelo, custoUsd: Math.max(j.reservaUsd ?? 0, 1e-6),
  estimado: true, tentativa: j.tentativa });

// O HEAD é o commit que o runner provou? (mesma árvore que o journal registrou antes de commitar)
function commitProvado(repo, j) {
  if (!j.arvoreProvada || head(repo) === j.base) return null;
  return arvoreDoHead(repo) === j.arvoreProvada ? head(repo) : null;
}

// Dúvida de autoria: nada é resetado nem aprovado; checkout e journal ficam e a maratona para.
function parar(c, j, motivo) {
  const texto = `execução interrompida (${j.featureId}, fase ${j.fase}): ${motivo}; checkout e journal preservados`;
  pararMaratona(c, texto);
  return { ok: false, motivo: texto };
}

async function terminarAprovacao(c, j, feature, commit) {
  if (feature.estado === 'aprovada') { await terminarRegistro(c, feature, commit); return { ok: true }; }
  const folha = j.folha ?? 'aprovação retomada depois de queda do processo';
  await gravarAprovacao(c, feature, j.tentativa, j.modelo, j.tipo)({ commit, custos: j.custos, folha, baseVermelha: j.baseVermelha, journalId: j.id, journalDia: j.dia,
    coberta: j.coberta, adiados: j.adiados });
  await aprovada(c, feature, j.modelo, { commit, custos: j.custos });
  return { ok: true };
}

function terminarGuardado(c, j, feature, commit) {
  falhou(c, feature, j.tentativa, j.modelo, { resultado: 'aguardando', commit, base: j.base, custos: j.custos, folha: j.folha, journalId: j.id, journalDia: j.dia,
    achados: j.achados ?? [], provas: j.provas ?? [], baseVermelha: j.baseVermelha });
  return { ok: true };
}

// A tentativa morreu antes de ter código provado: patch de tudo desde a base, volta à base e registra infra com custo estimado.
function abortar(c, j, feature) {
  const ramo = ramoAtual(c.repo);
  if (!ramo?.startsWith('maratona/')) return { ok: false, motivo: `reset recusado fora de maratona/* (${ramo ?? 'HEAD solto'}); nada foi tocado.` };
  const patch = path.join(c.deps.logs, `patch-${c.nome}-${feature.id}-t${j.tentativa}-queda-${Date.now()}.patch`);
  salvarPatch(c.repo, j.base, patch);
  reverter(c.repo, j.base, ramo);
  linhaDiario(`Tentativa interrompida em ${c.repo} (${feature.id}, fase ${j.fase}): tudo o que estava na branch ${ramo} foi guardado em ${patch} e a árvore voltou à base.`);
  falhou(c, feature, j.tentativa, j.modelo, { resultado: 'infra', tipo: 'infra', erro: `execução interrompida na fase ${j.fase}: o processo morreu`,
    custos: [...j.custos, estimadoDaQueda(j)], achados: [], patch, baseVermelha: j.baseVermelha, journalId: j.id, journalDia: j.dia });
  return { ok: true };
}

// Retentativa só da sessão limpa: o código já está commitado e fica; a tentativa interrompida conta como indisponibilidade.
async function reconciliarProva(c, j, feature) {
  if (j.fase === 'commitado') {
    return codigoIgual(c.repo, j.commit, 'HEAD') ? terminarAprovacao(c, j, feature, j.commit) : parar(c, j, 'o código mudou depois do commit aprovado');
  }
  const custos = [...j.custos, estimadoDaQueda(j)];
  if (!feature.aguardando) { gravarCustos(c.repo, custos, j.id, j.dia); atualizarRegistro(c); return { ok: true }; }
  const { base, commit, provas } = feature.aguardando;
  falhou(c, feature, j.tentativa, j.modelo, { resultado: 'aguardando', commit, base, custos, provas, journalId: j.id, journalDia: j.dia,
    achados: [`execução interrompida na fase ${j.fase}: o processo morreu`] });
  return { ok: true };
}

// Fases `base` e `portao`: a prova (da base ou do portão final) pode ter deixado arquivos gerados ou alterados; limpa e apaga o
// journal, sem tentativa e sem custo. O portão incompleto roda de novo no disparo seguinte, sem modelo.
function reconciliarBase(c, j) {
  if (head(c.repo) !== j.base) return parar(c, j, `o HEAD mudou durante ${j.fase === 'portao' ? 'o portão final' : 'a checagem da base'}`);
  limparContaminacao(c.repo);
  return { ok: true };
}

function reconciliarPlano(c, j) {
  const custos = [...j.custos, estimadoDaQueda(j)];
  gravarCustos(c.repo, custos, j.id, j.dia);
  const lista = carregarLista(c.repo).lista;
  salvarLista(c.repo, { ...lista, custo_plano_usd: (lista.custo_plano_usd ?? 0) + soma(custos) });
  atualizarRegistro(c);
  linhaDiario(`Plano de ${c.repo} interrompido (processo morreu); custo estimado US$ ${soma(custos).toFixed(4)} registrado.`);
  return { ok: true };
}

async function reconciliarTentativa(c, j) {
  const feature = carregarLista(c.repo).lista.features.find(f => f.id === j.featureId);
  if (['base', 'portao'].includes(j.fase) && !feature) return reconciliarBase(c, j);
  if (!feature) throw new ErroEstado(`Journal de ${c.nome} aponta para a feature ${j.featureId}, que não existe na lista; resolva e apague ${c.nome}.json em execucoes/.`);
  if (j.tipo === 'prova') return reconciliarProva(c, j, feature);
  if (['base', 'portao'].includes(j.fase)) return reconciliarBase(c, j);
  if (j.fase === 'commitado') {
    return codigoIgual(c.repo, j.commit, 'HEAD') ? terminarAprovacao(c, j, feature, j.commit) : parar(c, j, 'o código mudou depois do commit aprovado');
  }
  const commit = ['aprovando', 'guardando'].includes(j.fase) ? commitProvado(c.repo, j) : null;
  if (commit && j.fase === 'aprovando') return terminarAprovacao(c, j, feature, commit);
  if (commit) return terminarGuardado(c, j, feature, commit);
  if (head(c.repo) !== j.base) return parar(c, j, 'há commit novo na branch desde o início da tentativa (autoria não comprovada)');
  return abortar(c, j, feature);
}

// Devolve { ok:true } (nada pendente ou reconciliado) ou { ok:false, motivo } quando não dá para reconciliar com segurança.
export async function reconciliar(c) {
  const j = lerJournal(c.nome);
  if (!j) return { ok: true };
  c.saida(`[${c.nome}] execução interrompida detectada (${j.featureId}, fase ${j.fase}); reconciliando.`);
  const ramo = ramoAtual(c.repo);
  if (j.branch && ramo !== j.branch) {
    return { ok: false, motivo: `execução interrompida em ${j.branch}, mas o repositório está em ${ramo ?? 'HEAD solto'}: volte para ${j.branch} e rode de novo (nada foi tocado).` };
  }
  const r = j.tipo === 'plano' ? reconciliarPlano(c, j) : await reconciliarTentativa(c, j);
  if (r.ok) apagarJournal(c.nome);
  return r;
}

// Início do disparo, com a trava global: reconcilia TODOS os journals (não só o da candidata) para que o teto do dia enxergue o
// que ficou pendente. Devolve nome → { ok, motivo } ou { erro }; falha de um journal é isolada e o arquivo nunca é apagado.
export async function reconciliarTodos({ deps, saida, op }) {
  const registro = carregarRegistro().ativas, resultados = new Map();
  for (const { nome } of listarJournals()) {
    const alvo = registro[nome];
    if (paradaSolicitada(nome)) continue;
    if (!alvo || (alvo.status !== 'ativa' && !op.forcar)) continue; // não reconciliável agora: continua reservando o teto
    try { resultados.set(nome, await reconciliar({ nome, repo: alvo.repo, op, deps, saida })); } catch (erro) {
      resultados.set(nome, { erro });
      avisarUmaVezPorDia(`journal-${nome}`, `Journal de "${nome}" impede a retomada: ${erro.message}`);
      saida(`[${nome}] ${erro.message}`);
    }
  }
  return resultados;
}
