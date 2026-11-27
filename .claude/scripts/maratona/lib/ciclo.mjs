// Disparo da maratona: trava com renovação, retomada de execução interrompida, guardas, rodízio entre ativas, cota, teto e plano.
import path from 'node:path';
import { caminhos, ErroEstado, pegarTrava, soltarTrava, renovarTrava, linhaDiario, hoje } from './estado.mjs';
import { chamarClaude } from './modelo.mjs';
import { criarBiblioteca } from './biblioteca.mjs';
import { verificarSessaoLimpa } from './verificador.mjs';
import { modeloInicial } from './roteador.mjs';
import { guardaDoRepo, codigoMudou, head, ramoAtual } from './repo.mjs';
import { carregarLista, salvarLista, persistirMigracao, atualizarFeature, proxima, aplicarPlano, extrairJson, promptPlano, SISTEMA_PLANO } from './lista.mjs';
import { executarTentativa, retentarProva, traduzirComCusto, fontesDoProjeto, custoDe, MOTIVO_MUDOU } from './turno.mjs';
import { limites, normal, agoraIso, soma, carregarRegistro, salvarRegistro, acharNoRegistro, tocarRegistro, contarPasso, paradaSolicitada, estadoDoRegistro } from './registro.mjs';
import { abrirJournal, apagarJournal, acompanharProcesso } from './execucao.mjs';
import { restanteAgora, lancarCusto, tetoAgora } from './orcamento.mjs';
import { resultado, gravarAprovacao, bloquearPorTeto, progresso, gravarCustos, atualizarRegistro } from './veredito.mjs';
import { patchAnterior } from './fichas.mjs';
import { fecharMaratona } from './portaoFinal.mjs';
import { reconciliarTodos } from './reconciliar.mjs';
import { checarBaseInicial, checarPlanoNaBase } from './baseInicial.mjs';
import { lerJournal } from './execucao.mjs';

export { limites, carregarRegistro, salvarRegistro, acharNoRegistro, tocarRegistro } from './registro.mjs';

export function criarDeps(sobrescrever = {}) {
  return { chamarModelo: chamarClaude, verificar: verificarSessaoLimpa, biblioteca: criarBiblioteca({ dir: caminhos().biblioteca }),
    logs: caminhos().logs, executar: undefined, chamarVerificador: undefined, ...sobrescrever };
}

function tratarTeto(c, feature, teto) {
  if (/por feature/.test(teto.motivo)) { bloquearPorTeto(c, feature, teto.motivo); return { rodou: false, parar: false }; }
  c.saida(`[${c.nome}] ${teto.motivo} Nada foi gasto.`);
  return { rodou: false, parar: true, pararTudo: true };
}

async function passoFeature(c, feature, lista) {
  const teto = tetoAgora({ repo: c.repo, nome: c.nome, feature });
  if (!teto.ok) return tratarTeto(c, feature, teto);
  const n = feature.tentativas.length + 1;
  const modelo = c.op.modelo ?? feature.proximo_modelo ?? modeloInicial(feature);
  const res = await executarTentativa({ repo: c.repo, nome: c.nome, feature, n, modelo, achados: feature.achados ?? [], patchAnterior: patchAnterior(feature), limiteMin: c.op.limiteMin,
    deps: c.deps, lista, contarPasso: () => contarPasso(c.nome), aoAprovar: gravarAprovacao(c, feature, n, modelo) });
  return resultado(c, feature, n, modelo, res);
}

// Feature em espera que não pode andar agora (código mudou, sem orçamento): fica aguardando, avisa uma vez e não gasta.
function esperarDono(c, feature, motivo) {
  if (feature.motivo !== motivo) {
    salvarLista(c.repo, atualizarFeature(carregarLista(c.repo).lista, feature.id, f => ({ ...f, motivo })));
    linhaDiario(`${feature.id} aguarda decisão do dono em ${c.repo}: ${motivo}.`);
  }
  c.saida(`[${c.nome}] ${feature.id} segue aguardando: ${motivo}.`);
  return { rodou: false, parar: true };
}

async function passoProva(c, feature, lista) {
  const teto = tetoAgora({ repo: c.repo, nome: c.nome, feature });
  if (!teto.ok) return tratarTeto(c, feature, teto);
  if (!feature.aguardando?.commit) return esperarDono(c, feature, 'aguardando_prova sem o commit guardado (estado inconsistente)');
  if (codigoMudou(c.repo, feature.aguardando.commit)) return esperarDono(c, feature, MOTIVO_MUDOU);
  if (restanteAgora({ repo: c.repo, nome: c.nome, featureId: feature.id }) < limites().reservaVerificadorUsd) {
    return esperarDono(c, feature, 'teto: sem orçamento para a sessão limpa');
  }
  const n = feature.tentativas.length + 1;
  const res = await retentarProva({ repo: c.repo, nome: c.nome, feature, n, deps: c.deps, lista, contarPasso: () => contarPasso(c.nome),
    aoAprovar: gravarAprovacao(c, feature, n, 'codex', 'prova') });
  return resultado(c, feature, n, feature.proximo_modelo ?? modeloInicial(feature), res);
}

async function consultarPlano(c, semPlano, s) {
  const lancar = e => lancarCusto(s, e);
  const saldo = () => restanteAgora({ repo: c.repo, nome: c.nome, featureId: 'PLANO' });
  const base = { repo: c.repo, nome: c.nome, deps: c.deps, lancar, featureId: 'PLANO', n: 0, saldo };
  const projeto = await traduzirComCusto({ ...base, etapa: 'tradutor-projeto', fontes: fontesDoProjeto(c.repo), foco: 'projeto', tipo: 'projeto' });
  const prompt = promptPlano(semPlano, projeto);
  const saldoPlano = restanteAgora({ repo: c.repo, nome: c.nome, featureId: 'PLANO' });
  if (paradaSolicitada(c.nome)) return { adiado: true };
  if (saldoPlano <= 0) return { adiado: true }; // custo do tradutor já está no journal; o plano espera por saldo
  const out = await c.deps.chamarModelo({ prompt, sistema: SISTEMA_PLANO, modelo: 'sonnet', cwd: c.repo, ferramentas: ['Read', 'Glob', 'Grep'],
    limiteMin: 10, tetoUsd: Math.min(0.5, saldoPlano), onProcesso: acompanharProcesso(c.nome) });
  lancar({ featureId: 'PLANO', etapa: 'plano', modelo: 'sonnet', usage: out.usage, tentativa: 0, ...custoDe(out, 'sonnet', Math.ceil(prompt.length / 3.6)) });
  return out;
}

// Plano: define `verificacao` por feature uma vez só (sonnet, sem ferramentas de escrita), recusa prova já verde na base e congela.
async function passoPlano(c, lista, semPlano) {
  const teto = tetoAgora({ repo: c.repo, nome: c.nome, feature: 'PLANO' });
  if (!teto.ok) return tratarTeto(c, { id: 'PLANO' }, { ...teto, motivo: teto.motivo.replace('por feature', 'do plano') });
  const journal = abrirJournal(c.nome, { tipo: 'plano', fase: 'plano', repo: c.repo, branch: ramoAtual(c.repo), base: head(c.repo), featureId: 'PLANO', tentativa: 0,
    modelo: 'sonnet', reservaUsd: Math.min(teto.restanteUsd, limites().reservaTurnoUsd) });
  contarPasso(c.nome);
  const s = { nome: c.nome, custos: [] };
  const out = await consultarPlano(c, semPlano, s);
  gravarCustos(c.repo, s.custos, journal.id, journal.dia);
  const atual = carregarLista(c.repo).lista;
  const comCusto = { ...atual, custo_plano_usd: (atual.custo_plano_usd ?? 0) + soma(s.custos) };
  salvarLista(c.repo, comCusto);
  if (out.adiado) {
    c.saida(`[${c.nome}] plano adiado: sem saldo no orçamento depois do tradutor.`);
    atualizarRegistro(c); apagarJournal(c.nome);
    return { rodou: true, parar: true };
  }
  const r = out.erro || out.cortadoPor ? falhaPlano(c, comCusto, out) : await aceitarPlano(c, comCusto, semPlano, extrairJson(out.resultado));
  atualizarRegistro(c);
  apagarJournal(c.nome);
  return r;
}

async function aceitarPlano(c, lista, semPlano, resposta) {
  const base = await checarPlanoNaBase({ repo: c.repo, nome: c.nome, lista, resposta, deps: c.deps });
  salvarLista(c.repo, aplicarPlano({ ...lista, plano_falhas: 0 }, resposta, { ...base, sha: head(c.repo) }));
  const bloqueadas = carregarLista(c.repo).lista.features.filter(f => f.motivo?.startsWith('plano')).map(f => f.id);
  progresso(c.repo, 'Plano', [`verificação definida para ${semPlano.length - bloqueadas.length} feature(s)`, ...(bloqueadas.length ? [`bloqueadas sem plano válido: ${bloqueadas.join(', ')}`] : [])]);
  if (bloqueadas.length) linhaDiario(`Plano em ${c.repo}: ${bloqueadas.join(', ')} bloqueada(s) sem verificação válida.`);
  c.saida(`[${c.nome}] plano gravado (${semPlano.length} feature(s)).`);
  return { rodou: true, parar: false };
}

function falhaPlano(c, lista, out) {
  const falhas = (lista.plano_falhas ?? 0) + 1, desistir = falhas >= limites().maxInfra;
  const nova = desistir ? { ...lista, plano_falhas: falhas, features: lista.features.map(f => (f.estado === 'precisa_plano'
    ? { ...f, estado: 'bloqueada', bloqueios: f.bloqueios + 1, motivo: 'plano: modelo indisponível após 3 tentativas' } : f)) } : { ...lista, plano_falhas: falhas };
  salvarLista(c.repo, nova);
  linhaDiario(`Falha de infra no plano de ${c.repo} (${falhas}/${limites().maxInfra}): ${String(out.erro ?? out.cortadoPor).slice(0, 160)}.`);
  c.saida(`[${c.nome}] plano falhou (${falhas}): ${String(out.erro ?? out.cortadoPor).slice(0, 160)}`);
  return { rodou: true, parar: true };
}

function executarPasso(c, lista, p) {
  if (p.tipo === 'plano') return passoPlano(c, lista, p.features);
  return p.tipo === 'prova' ? passoProva(c, p.feature, lista) : passoFeature(c, p.feature, lista);
}

function cotaEsgotada(nome, forcar) {
  const r = carregarRegistro().ativas[nome];
  const passos = r?.ultimo_dia === hoje() ? r.passos_hoje ?? 0 : 0;
  return !forcar && passos >= limites().maxPassosDia ? passos : null;
}

async function fecharSemTrabalho(c, p) {
  const status = p.concluida ? 'concluida' : 'parada_bloqueada';
  const fim = await fecharMaratona(c, { concluida: p.concluida });
  if (!fim.fechada || !fim.passou) return; // portão final pendente ou reprovado: a mensagem já saiu
  linhaDiario(p.concluida ? `Maratona "${c.nome}" CONCLUÍDA em ${c.repo}.` : `Maratona "${c.nome}" PARADA COM BLOQUEIOS em ${c.repo} (nenhuma feature pendente).`);
  c.saida(`[${c.nome}] ${status}; nada a fazer.`);
}

async function rodarPassos(c, maxPassos) {
  let rodados = 0;
  for (let i = 0; i < maxPassos; i++) {
    if (paradaSolicitada(c.nome)) { c.saida(`[${c.nome}] parada solicitada; disparo encerrado.`); break; }
    const lista = carregarLista(c.repo).lista;
    const p = proxima(lista, { forcar: c.op.forcar });
    if (p.tipo === 'nada') { await fecharSemTrabalho(c, p); break; }
    if (p.tipo === 'espera') { c.saida(`[${c.nome}] ${p.feature.id} aguarda sessão limpa até ${p.ate}.`); break; }
    const cota = cotaEsgotada(c.nome, c.op.forcar);
    if (cota != null) { c.saida(`[${c.nome}] cota diária atingida (${cota}/${limites().maxPassosDia}).`); break; }
    const r = await executarPasso(c, lista, p);
    if (r.rodou) rodados++;
    if (r.pararTudo) return { rodados, pararTudo: true };
    if (r.parar) break;
  }
  return { rodados, pararTudo: false };
}

function candidatos(reg, op) {
  if (op.repo) {
    const achada = acharNoRegistro(reg, op.repo);
    if (achada) return [achada];
    const nome = path.basename(normal(op.repo)).toLowerCase().replace(/[^a-z0-9-]/g, '-');
    return [{ nome, repo: normal(op.repo), status: 'ativa', modelo: null, semRegistro: true }];
  }
  return Object.values(reg.ativas).filter(r => r.status === 'ativa')
    .sort((a, b) => (a.ultimo_passo_em ?? '').localeCompare(b.ultimo_passo_em ?? ''));
}

// Ordem: ler lista → reconciliar execução interrompida → guardas do repo → só então migração, registro e passos.
async function tentarMaratona(alvo, op, deps, saida, pendencias) {
  const c = { nome: alvo.nome, repo: alvo.repo, op, deps, saida };
  if (paradaSolicitada(alvo.nome)) { saida(`[${alvo.nome}] está ${estadoDoRegistro(carregarRegistro().ativas[alvo.nome] ?? alvo)}; --forcar não retoma.`); return { rodados: 0 }; }
  if (alvo.status !== 'ativa' && !op.forcar) { saida(`[${alvo.nome}] está ${alvo.status}; ignorada (--forcar para executar).`); return { rodados: 0 }; }
  const rec = pendencias.get(alvo.nome);
  if (rec?.erro) throw rec.erro;
  if (rec && !rec.ok) { saida(`[${alvo.nome}] ${rec.motivo}`); return { rodados: 0 }; }
  if (lerJournal(alvo.nome)) throw new ErroEstado(`Journal pendente de ${alvo.nome} não reconciliado; nada de trabalho novo sobre ele.`); // ilegível já lançou
  const { lista, migrada } = carregarLista(alvo.repo);
  const guarda = guardaDoRepo(alvo.repo);
  if (guarda) { saida(`[${alvo.nome}] ${guarda}`); return { rodados: 0 }; }
  if (migrada) { persistirMigracao(alvo.repo, lista); saida(`[${alvo.nome}] feature_list migrada da v1 (cópia em feature_list.v1.json).`); }
  if (alvo.semRegistro) {
    const reg = carregarRegistro();
    salvarRegistro({ ...reg, ativas: { ...reg.ativas, [alvo.nome]: { nome: alvo.nome, repo: alvo.repo, objetivo: lista.objetivo, modelo: null, criada_em: agoraIso(),
      atualizada_em: agoraIso(), passos_hoje: 0, ultimo_dia: hoje(), ultimo_passo_em: null, custo_total_usd: 0, status: 'ativa' } } });
  }
  if (!op.forcar && carregarRegistro().ativas[alvo.nome]?.status !== 'ativa') return { rodados: 0 }; // a reconciliação pode ter concluído
  await checarBaseInicial(c);
  return rodarPassos(c, op.agendada ? limites().passosPorDisparo : 1);
}

// Uma candidata quebrada não paralisa as outras: o erro vai para a saída e o rodízio segue. Registro global ilegível falha fechado.
async function percorrer(alvos, op, deps, saida, pendencias) {
  const erros = [];
  for (const alvo of alvos) {
    try {
      const r = await tentarMaratona(alvo, op, deps, saida, pendencias);
      if (r.rodados > 0 || r.pararTudo) return r;
    } catch (e) {
      if (alvos.length === 1) throw e;
      erros.push(e);
      saida(`[${alvo.nome}] erro: ${e.message} (estado dela intacto); seguindo para a próxima.`);
    }
  }
  if (erros.length) throw erros[0];
  saida('nada a fazer');
  return { rodados: 0 };
}

// Uma trava para o disparo inteiro, com batida periódica enquanto durar; erros de estado (ErroEstado) sobem sem sobrescrever nada.
export async function disparo(op, deps = criarDeps()) {
  const saida = op.saida ?? (() => {});
  const trava = pegarTrava('maratona');
  if (!trava.ok) { saida(trava.motivo); return { rodados: 0 }; }
  const batida = setInterval(() => {
    try { renovarTrava('maratona'); } catch (e) { saida(`aviso: não foi possível renovar a trava (${e.message})`); }
  }, limites().batidaSeg * 1000);
  batida.unref();
  try {
    const alvos = candidatos(carregarRegistro(), op);
    if (!alvos.length) { saida('nenhuma maratona ativa (use: passo <repo>, ou nova primeiro)'); return { rodados: 0 }; }
    const pendencias = await reconciliarTodos({ deps, saida, op });
    return await percorrer(alvos, op, deps, saida, pendencias);
  } finally { clearInterval(batida); soltarTrava(); }
}
