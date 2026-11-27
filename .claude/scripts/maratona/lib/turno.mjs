// Uma tentativa de feature: guardas → estado → journal → fichas → turno → prova → (sessão limpa) → commit provado → veredito do runner.
// O agente nunca decide `passes`: só o runner, depois de provar e de conferir que o commit contém exatamente a árvore provada.
// Custos e estado só são gravados depois do veredito; durante a tentativa o gasto fica no journal (fora do repo).
import fs from 'node:fs';
import path from 'node:path';
import { estimarTokens, limpar, mascararSegredos } from './tradutor.mjs';
import { rodarVerificacao, checarIntegridade, normalizarComandos } from './prova.mjs';
import { provaNaBase } from './base.mjs';
import { comandosDaProva, chaveComando, textoAdiados, provasAdiadas } from './portao.mjs';
import { classificarRisco } from './roteador.mjs';
import { git, head, ramoAtual, guardaDoRepo, limparContaminacao, prepararRamo, commitarEstado, prepararCommit, commitarCodigo, arvoreDoIndice, arvoreDoHead,
  salvarPatch, reverter, desfazerCommit, marcarIntencao, desmarcarIntencao, tamanhoDiff, codigoMudou } from './repo.mjs';
import { abrirJournal, atualizarJournal, acompanharProcesso } from './execucao.mjs';
import { restanteAgora, lancarCusto, custoDe } from './orcamento.mjs';
import { limites, agoraIso, conferirParada, paradaSolicitada, ErroParada } from './registro.mjs';
import { montarPrompt, montarFichas, mensagemCommit, resumoFeature, formatarAchado } from './fichas.mjs';

export { custoDe } from './orcamento.mjs';
export { tipoCommit, mensagemCommit, montarPrompt, formatarAchado, fontesDoProjeto, traduzirComCusto } from './fichas.mjs';
export const SISTEMA_TURNO = fs.readFileSync(new URL('../regras-turno.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n').trim();
export const FERRAMENTAS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'];
export const MOTIVO_MUDOU = 'código mudou depois do commit guardado';
const MOTIVO_TETO = 'teto: sem orçamento para a sessão limpa';

export function folhaDaProva(prova, adiados = []) {
  const itens = prova.itens.map(i => `- \`${i.cmd}\` → código ${i.code} em ${(i.ms / 1000).toFixed(1)}s, sha256 ${i.sha256.slice(0, 12)}`);
  return [...itens, ...textoAdiados(adiados)].join('\n');
}
export const provasCompactas = (prova, adiados = []) => [...prova.itens.map(i => ({ comando: i.cmd, codigo: i.code, duracaoS: Math.round(i.ms / 100) / 10, sha256: i.sha256 })), ...provasAdiadas(adiados)];
// Comandos que falharam na base: base do portão de comandos compartilhados (E-5).
const falhosNaBase = prova => prova.itens.filter(i => i.code !== 0).map(i => chaveComando(i.cmd));

// Guardas que não tocam em nada, depois ramo da maratona e commit do estado pendente.
function iniciar(s) {
  if (paradaSolicitada(s.nome)) return { motivo: 'Parada solicitada; nenhum trabalho novo.' };
  const motivo = guardaDoRepo(s.repo);
  if (motivo) return { motivo };
  let ramo;
  try { ramo = prepararRamo(s.repo, s.nome); } catch (e) { return { motivo: e.message }; }
  commitarEstado(s.repo, `chore(maratona): estado antes de ${s.feature.id} t${s.n}`);
  return { ramo, base: head(s.repo) };
}

// Antes de qualquer chamada paga: journal (identidade, base, fase, reserva) e o passo na cota.
function reservar(s, tipo, base = s.base) {
  const reservaUsd = Math.min(restanteAgora({ repo: s.repo, nome: s.nome, featureId: s.feature.id }), limites().reservaTurnoUsd);
  const journal = abrirJournal(s.nome, { tipo, repo: s.repo, branch: s.ramo, base, featureId: s.feature.id, tentativa: s.n, modelo: s.modelo, reservaUsd });
  Object.assign(s, { journalId: journal.id, journalDia: journal.dia });
  s.contarPasso?.();
}
const fase = (s, nome, extra = {}) => atualizarJournal(s.nome, { fase: nome, ...extra });

function encerrar(s, resultado) {
  const patch = path.join(s.deps.logs, `patch-${s.nome}-${s.feature.id}-t${s.n}-${Date.now()}.patch`);
  salvarPatch(s.repo, s.base, patch);
  reverter(s.repo, s.base, s.ramo);
  return { custos: s.custos, base: s.base, patch, ...resultado };
}

// Prova vermelha na base (uma vez por feature, se o primeiro disparo não a fez): comando que já passa não prova nada;
// timeout/erro é infra, não vermelho. A sujeira que a própria prova deixar é restaurada por provaNaBase.
async function checarBaseVermelha(s) {
  if (s.feature.base_vermelha || s.feature.refatoracao === true) return null;
  const { estado, prova } = await provaNaBase({ repo: s.repo, nome: s.nome, featureId: s.feature.id, verificacao: s.feature.verificacao, deps: s.deps });
  if (estado === 'infra') {
    const quebrado = prova.itens.find(i => i.code === -1);
    return { resultado: 'infra', tipo: 'infra', erro: `Prova indisponível na base: ${String(quebrado.cauda).trim().slice(0, 200) || quebrado.cmd}`, custos: [], achados: [], base: s.base };
  }
  if (estado === 'verde') return { resultado: 'prova-verde', custos: [], base: s.base };
  s.baseVermelha = { em: agoraIso(), sha: s.base, commit: s.base, comandos: falhosNaBase(prova) };
  return null;
}

// Feature coberta (piloto real): a base era vermelha para esta feature, mas commits de outras features já a deixaram verde.
// Nada a implementar: aprova como coberta (custo 0, só commit de estado). Risco alto passa antes pela sessão limpa
// (base = a base vermelha, head = HEAD atual). Prova vermelha, ou infra, segue o caminho normal.
async function tentarCoberta(s) {
  const f = s.feature;
  if (!f.base_vermelha || f.tentativas.length > 0) return null;
  const { rodar, adiados } = comandosDaProva(f, s.lista);
  const { estado, prova } = await provaNaBase({ repo: s.repo, nome: s.nome, featureId: f.id, verificacao: rodar, deps: s.deps });
  if (estado !== 'verde') return null;
  const commit = head(s.repo), vermelha = String(f.base_vermelha.commit ?? f.base_vermelha.sha).slice(0, 7);
  const folha = `coberta por commits anteriores (HEAD ${commit.slice(0, 7)}): a prova que falhava em ${vermelha} passa agora
${folhaDaProva(prova, adiados)}`;
  const dados = { commit, folha, provas: provasCompactas(prova, adiados), adiados: adiados.map(a => a.cmd) };
  return classificarRisco(f) === 'alto' ? revisarCoberta(s, dados) : aprovarCoberta(s, dados);
}

async function aprovarCoberta(s, dados) {
  conferirParada(s.nome);
  const { commit, folha } = dados;
  const journal = abrirJournal(s.nome, { tipo: 'feature', repo: s.repo, branch: s.ramo, base: s.base, featureId: s.feature.id, tentativa: s.n, modelo: s.modelo,
    reservaUsd: 0, fase: 'commitado', commit, folha, coberta: true, adiados: dados.adiados });
  Object.assign(s, { journalId: journal.id, journalDia: journal.dia });
  s.commitado = true;
  await s.aoAprovar({ commit, custos: s.custos, folha, journalId: s.journalId, journalDia: s.journalDia, coberta: true, adiados: dados.adiados });
  return { resultado: 'coberta', commit, base: s.base, custos: s.custos, folha };
}

function esperaCoberta(s, { commit, folha, provas }, achados, motivo) {
  return { resultado: 'aguardando', coberta: true, commit, base: s.feature.base_vermelha.commit, custos: s.custos, folha, achados, provas, ...(motivo ? { motivo } : {}) };
}

async function revisarCoberta(s, dados) {
  reservar(s, 'feature');
  const fichas = await montarFichas(s);
  conferirParada(s.nome);
  if (restanteAgora({ repo: s.repo, nome: s.nome, featureId: s.feature.id }) < limites().reservaVerificadorUsd) return esperaCoberta(s, dados, [], MOTIVO_TETO);
  fase(s, 'sessao-limpa');
  const ficha = `${fichas.projeto}
${fichas.ficha}`;
  const v = await s.deps.verificar({ repo: s.repo, base: s.feature.base_vermelha.commit, head: dados.commit, feature: resumoFeature(s.feature),
    ficha, provas: dados.provas, chamar: s.deps.chamarVerificador, onProcesso: acompanharProcesso(s.nome) });
  lancarCusto(s, { featureId: s.feature.id, etapa: 'sessao-limpa', modelo: 'codex', veredito: v.veredito, tentativa: s.n, ...custoDe(v, 'codex', estimarTokens(ficha) + 20_000) });
  const achados = v.achados.map(formatarAchado);
  if (v.veredito === 'INDISPONIVEL') return esperaCoberta(s, dados, achados);
  if (v.veredito === 'REPROVADO') return { resultado: 'reprovada', tipo: 'revisao', coberta: true, base: s.base, custos: s.custos, folha: dados.folha, achados };
  conferirParada(s.nome);
  s.commitado = true;
  fase(s, 'commitado', { commit: dados.commit, folha: dados.folha, coberta: true, adiados: dados.adiados });
  await s.aoAprovar({ commit: dados.commit, custos: s.custos, folha: dados.folha, journalId: s.journalId, journalDia: s.journalDia, coberta: true, adiados: dados.adiados });
  return { resultado: 'coberta', commit: dados.commit, base: s.base, custos: s.custos, folha: dados.folha };
}

async function rodarTurno(s, fichas) {
  conferirParada(s.nome);
  const prompt = montarPrompt({ feature: s.feature, n: s.n, patchAnterior: s.patchAnterior, comandos: comandosDaProva(s.feature, s.lista).rodar, ...fichas });
  fase(s, 'turno');
  const out = await s.deps.chamarModelo({ prompt, sistema: SISTEMA_TURNO, modelo: s.modelo, cwd: s.repo,
    ferramentas: FERRAMENTAS, limiteMin: s.limiteMin, tetoUsd: restanteAgora({ repo: s.repo, nome: s.nome, featureId: s.feature.id }), onProcesso: acompanharProcesso(s.nome) });
  lancarCusto(s, { featureId: s.feature.id, etapa: 'turno', modelo: s.modelo, usage: out.usage, tentativa: s.n, ...custoDe(out, s.modelo, estimarTokens(prompt)) });
  return out;
}

function achadosDaProva(prova) {
  return prova.itens.filter(i => i.code !== 0).map(i =>
    `Comando falhou: ${i.cmd} (código ${i.code})\n${limpar(mascararSegredos(i.cauda), { maxTokens: 250 })}`);
}

async function integridade(s) {
  const r = await checarIntegridade({ repo: s.repo, base: s.base, permiteTestes: s.feature.permite_testes === true });
  const problemas = [...r.problemas];
  if (head(s.repo) !== s.base) problemas.push('O agente criou commit; só o runner commita.');
  if (ramoAtual(s.repo) !== s.ramo) problemas.push('O agente trocou de branch.');
  return problemas;
}

const tipoIntegridade = ps => (ps.length === 1 && /^Nada mudou/.test(ps[0]) ? 'sem-mudanca' : 'integridade');

async function provar(s) {
  fase(s, 'prova');
  const antes = await integridade(s);
  if (antes.length) return { ok: false, tipo: tipoIntegridade(antes), achados: antes };
  const { rodar, adiados } = comandosDaProva(s.feature, s.lista);
  const prova = await rodarVerificacao({ repo: s.repo, comandos: rodar, executar: s.deps.executar });
  const folha = folhaDaProva(prova, adiados);
  if (!prova.ok) return { ok: false, tipo: 'prova', achados: achadosDaProva(prova), folha };
  const depois = await integridade(s);
  // provas_passaram só depois de TODAS as provas executadas passarem: a integridade final reprovada deixa um patch reaproveitável.
  return depois.length ? { ok: false, tipo: 'integridade', achados: depois, folha, provas_passaram: true } : { ok: true, folha, provas: provasCompactas(prova, adiados), adiados: adiados.map(a => a.cmd) };
}

// Risco alto exige sessão limpa com outro motor; risco baixo dispensa. Sem orçamento para ela, não chama: o trabalho espera.
async function revisar(s, fichas, prova) {
  if (classificarRisco(s.feature) !== 'alto') return { veredito: 'APROVADO', achados: [] };
  if (restanteAgora({ repo: s.repo, nome: s.nome, featureId: s.feature.id }) < limites().reservaVerificadorUsd) {
    return { veredito: 'INDISPONIVEL', achados: [], motivo: MOTIVO_TETO };
  }
  fase(s, 'sessao-limpa');
  marcarIntencao(s.repo);
  let v, entradaTokens;
  try {
    entradaTokens = estimarTokens(`${fichas.projeto}${fichas.ficha}`) + Math.ceil(tamanhoDiff(s.repo, s.base) / 3.6);
    v = await s.deps.verificar({ repo: s.repo, base: s.base, feature: resumoFeature(s.feature),
      ficha: `${fichas.projeto}\n${fichas.ficha}`, provas: prova.provas, chamar: s.deps.chamarVerificador, onProcesso: acompanharProcesso(s.nome) });
  } finally { desmarcarIntencao(s.repo); }
  lancarCusto(s, { featureId: s.feature.id, etapa: 'sessao-limpa', modelo: 'codex', veredito: v.veredito, tentativa: s.n, ...custoDe(v, 'codex', entradaTokens) });
  return v;
}

// Commit do código com hooks; o que entrou no commit tem de ser exatamente a árvore que foi provada.
function commitarProvado(s, arvore, folha) {
  conferirParada(s.nome);
  let commit;
  try { commit = commitarCodigo(s.repo, mensagemCommit(s.feature)); } catch (e) {
    return { res: encerrar(s, { resultado: 'infra', tipo: 'infra', erro: `Commit recusado: ${e.message}`, achados: [], folha }) };
  }
  if (arvoreDoHead(s.repo) === arvore) return { commit };
  return { res: encerrar(s, { resultado: 'reprovada', tipo: 'integridade', folha,
    achados: ['Hook de commit alterou o conteúdo depois da prova; tentativa descartada e patch guardado.'] }) };
}

async function aprovar(s, prova) {
  const prep = prepararCommit(s.repo);
  if (!prep.ok) return encerrar(s, { resultado: 'reprovada', tipo: 'integridade', folha: prova.folha,
    achados: [prep.vazio ? 'Nada para commitar.' : `Segredo no commit: ${prep.segredos.join(', ')}`] });
  const arvore = arvoreDoIndice(s.repo);
  fase(s, 'aprovando', { arvoreProvada: arvore, folha: prova.folha, baseVermelha: s.baseVermelha, adiados: prova.adiados });
  const r = commitarProvado(s, arvore, prova.folha);
  if (r.res) return r.res;
  s.commitado = true;
  fase(s, 'commitado', { commit: r.commit });
  await s.aoAprovar({ commit: r.commit, custos: s.custos, folha: prova.folha, baseVermelha: s.baseVermelha, journalId: s.journalId, journalDia: s.journalDia, adiados: prova.adiados });
  return { resultado: 'aprovada', commit: r.commit, base: s.base, custos: s.custos, folha: prova.folha };
}

// Sessão limpa fora do ar (ou sem orçamento): o trabalho provado fica commitado na branch da maratona e a revisão é refeita depois.
function guardar(s, prova, rev) {
  const prep = prepararCommit(s.repo);
  if (!prep.ok) return encerrar(s, { resultado: 'reprovada', tipo: 'integridade', folha: prova.folha, achados: ['Nada para commitar ou segredo no commit.'] });
  const achados = rev.achados.map(formatarAchado), arvore = arvoreDoIndice(s.repo);
  fase(s, 'guardando', { arvoreProvada: arvore, folha: prova.folha, achados, provas: prova.provas, baseVermelha: s.baseVermelha });
  const r = commitarProvado(s, arvore, prova.folha);
  if (r.res) return r.res;
  return { resultado: 'aguardando', commit: r.commit, base: s.base, custos: s.custos, folha: prova.folha, achados, provas: prova.provas,
    ...(rev.motivo ? { motivo: rev.motivo } : {}) };
}

function reprovar(s, prova, out) {
  const relato = prova.tipo === 'sem-mudanca' ? mascararSegredos(String(out.resultado ?? '')).slice(0, 500) : '';
  const achados = relato ? [...prova.achados, `Relato final do modelo: ${relato}`] : prova.achados;
  return encerrar(s, { resultado: 'reprovada', tipo: prova.tipo, achados, folha: prova.folha, ...(relato ? { relato } : {}),
    ...(prova.provas_passaram === true ? { provas_passaram: true } : {}) });
}

async function corpo(s) {
  const fichas = await montarFichas(s);
  if (restanteAgora({ repo: s.repo, nome: s.nome, featureId: s.feature.id }) <= 0) {
    return encerrar(s, { resultado: 'infra', tipo: 'corte', cortadoPor: 'teto', achados: [] });
  }
  const out = await rodarTurno(s, fichas);
  conferirParada(s.nome);
  // Corte por tempo/teto não é infra: o roteador conta como tentativa. Infra verdadeira (não iniciou, rede) limita a 3 no ciclo.
  if (out.erro || out.cortadoPor) return encerrar(s, { resultado: 'infra', tipo: out.cortadoPor ? 'corte' : 'infra', erro: out.erro, cortadoPor: out.cortadoPor, achados: [] });
  const prova = await provar(s);
  conferirParada(s.nome);
  if (!prova.ok) return reprovar(s, prova, out);
  const rev = await revisar(s, fichas, prova);
  conferirParada(s.nome);
  if (rev.veredito === 'REPROVADO') return encerrar(s, { resultado: 'reprovada', tipo: 'revisao', folha: prova.folha, achados: rev.achados.map(formatarAchado) });
  if (rev.veredito === 'INDISPONIVEL') return guardar(s, prova, rev);
  return aprovar(s, prova);
}

export async function executarTentativa(ctx) {
  const s = { ...ctx, custos: [] };
  const ini = iniciar(s);
  if (ini.motivo) return { resultado: 'guarda', motivo: ini.motivo, custos: [] };
  Object.assign(s, ini);
  try {
    const parada = await checarBaseVermelha(s);
    if (parada) return parada;
    const res = (await tentarCoberta(s)) ?? (reservar(s, 'feature'), await corpo(s));
    return { ...res, journalId: s.journalId, journalDia: s.journalDia, ...(s.baseVermelha ? { baseVermelha: s.baseVermelha } : {}) };
  } catch (e) {
    if (s.commitado) throw e; // código já commitado: o journal 'commitado' deixa o próximo disparo terminar a aprovação
    return encerrar(s, { resultado: 'infra', tipo: e instanceof ErroParada ? 'parada' : 'infra',
      erro: e instanceof ErroParada ? e.message : `Falha do runner: ${e.message}`, achados: [], journalId: s.journalId, journalDia: s.journalDia });
  }
}

// Repete só a sessão limpa de um trabalho já commitado (aguardando_prova); não refaz o turno.
export async function retentarProva(ctx) {
  const s = { ...ctx, custos: [], modelo: 'codex' };
  const res = await retentar(s);
  return { ...res, journalId: s.journalId, journalDia: s.journalDia };
}

// Toda retentativa de aguardando_prova (coberta ou não) reexecuta a verificação no checkout ANTES da sessão limpa: a prova que
// foi verde na espera pode ter ficado vermelha (fixture, ambiente) sem o código mudar. O revisor recebe só as provas novas.
// Vermelho/infra em coberta: nada a reverter (o commit é de outras features), volta ao caminho normal. Vermelho em não coberta:
// patch + revert como reprovação. Infra em não coberta só espera.
async function reexecutarProva(s, base, commit) {
  fase(s, 'prova');
  const { rodar, adiados } = comandosDaProva(s.feature, s.lista);
  const prova = await rodarVerificacao({ repo: s.repo, comandos: rodar, executar: s.deps.executar });
  limparContaminacao(s.repo); // a árvore estava limpa antes: o que a prova gerou é dela
  const folha = folhaDaProva(prova, adiados), coberta = s.feature.aguardando.coberta === true;
  if (paradaSolicitada(s.nome)) return { res: { resultado: 'aguardando', semContar: true, motivo: 'Parada solicitada', commit, base, custos: s.custos, achados: [], provas: s.feature.aguardando.provas } };
  if (prova.ok) return { provas: provasCompactas(prova, adiados), folha, adiados: adiados.map(a => a.cmd) };
  const base_ = { custos: s.custos, folha, commit, base };
  if (prova.itens.some(i => i.code === -1)) {
    const erro = 'Prova indisponível na retentativa (timeout ou erro do comando).';
    return { res: coberta ? { ...base_, resultado: 'infra', tipo: 'infra', erro, achados: [] }
      : { ...base_, resultado: 'aguardando', semContar: true, motivo: erro, achados: [], provas: s.feature.aguardando.provas } };
  }
  const reprovada = { ...base_, resultado: 'reprovada', tipo: 'prova', achados: achadosDaProva(prova) };
  return { res: coberta ? reprovada : desfazerGuardado(s, base, commit, reprovada) };
}

// Desfaz o commit guardado (patch + revert). Se o revert falhar, a feature continua aguardando com o motivo: nunca fica commit sem dono.
function desfazerGuardado(s, base, commit, res) {
  try { return { ...res, patch: descartarCommit(s, base, commit) }; } catch (e) {
    return { resultado: 'aguardando', semContar: true, motivo: `não foi possível desfazer o commit guardado: ${e.message}`.slice(0, 400),
      commit, base, custos: s.custos, achados: [], provas: s.feature.aguardando.provas, coberta: s.feature.aguardando.coberta };
  }
}

async function retentar(s) {
  const ini = iniciar(s);
  if (ini.motivo) return { resultado: 'guarda', motivo: ini.motivo, custos: [] };
  Object.assign(s, ini);
  const { base, commit } = s.feature.aguardando;
  try {
    reservar(s, 'prova', base);
    const nova = await reexecutarProva(s, base, commit);
    if (nova.res) return nova.res;
    const { provas } = nova;
    const f = await montarFichas({ ...s, achados: [] });
    if (paradaSolicitada(s.nome)) return { resultado: 'aguardando', semContar: true, motivo: 'Parada solicitada', commit, base, custos: s.custos, achados: [], provas };
    if (restanteAgora({ repo: s.repo, nome: s.nome, featureId: s.feature.id }) < limites().reservaVerificadorUsd) {
      return { resultado: 'aguardando', semContar: true, motivo: MOTIVO_TETO, commit, base, custos: s.custos, achados: [], provas };
    }
    fase(s, 'sessao-limpa');
    const v = await s.deps.verificar({ repo: s.repo, base, head: commit, feature: resumoFeature(s.feature),
      ficha: `${f.projeto}
${f.ficha}`, provas, chamar: s.deps.chamarVerificador, onProcesso: acompanharProcesso(s.nome) });
    lancarCusto(s, { featureId: s.feature.id, etapa: 'sessao-limpa', modelo: 'codex', veredito: v.veredito, tentativa: s.n,
      ...custoDe(v, 'codex', estimarTokens(`${f.projeto}${f.ficha}`) + 20_000) });
    return await veredito(s, base, commit, v, nova);
  } catch (e) {
    if (s.commitado) throw e;
    if (e instanceof ErroParada) return { resultado: 'aguardando', semContar: true, motivo: e.message, commit, base, custos: s.custos, achados: [], provas: s.feature.aguardando.provas };
    return { resultado: 'infra', tipo: 'infra', erro: `Falha do runner: ${e.message}`, custos: s.custos, achados: [] };
  }
}

async function veredito(s, base, commit, v, { provas, folha: folhaProva, adiados }) {
  if (paradaSolicitada(s.nome)) return { resultado: 'aguardando', semContar: true, motivo: 'Parada solicitada', commit, base, custos: s.custos, achados: [], provas };
  // O veredito vale para o commit guardado: se o código mudou nesse meio tempo, nada é publicado.
  if (codigoMudou(s.repo, commit)) return { resultado: 'aguardando', semContar: true, motivo: MOTIVO_MUDOU, commit, base, custos: s.custos, achados: [], provas };
  if (v.veredito === 'INDISPONIVEL') return { resultado: 'aguardando', commit, base, custos: s.custos, achados: v.achados.map(formatarAchado), provas };
  if (v.veredito === 'APROVADO') {
    s.commitado = true;
    const folha = `sessão limpa aprovada em nova tentativa
${folhaProva}`;
    fase(s, 'commitado', { commit, folha, adiados });
    await s.aoAprovar({ commit, custos: s.custos, folha, journalId: s.journalId, journalDia: s.journalDia, coberta: s.feature.aguardando.coberta, adiados });
    return { resultado: 'aprovada', commit, base, custos: s.custos };
  }
  const reprovada = { resultado: 'reprovada', tipo: 'revisao', commit, base, custos: s.custos, achados: v.achados.map(formatarAchado) };
  return s.feature.aguardando.coberta ? reprovada : desfazerGuardado(s, base, commit, reprovada);
}

// Guarda o patch e desfaz o commit com revert (há commits de estado por cima, então nada de reset).
export function descartarCommit({ repo, deps, nome, feature }, base, commit) {
  const patch = path.join(deps.logs, `patch-${nome}-${feature.id}-prova-${Date.now()}.patch`);
  fs.mkdirSync(deps.logs, { recursive: true });
  fs.writeFileSync(patch, git(repo, ['diff', '--binary', '--no-ext-diff', '--no-textconv', base, commit]));
  commitarEstado(repo, `chore(maratona): estado antes de desfazer ${feature.id}`);
  desfazerCommit(repo, commit);
  return patch;
}
