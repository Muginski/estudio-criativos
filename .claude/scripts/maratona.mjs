#!/usr/bin/env node
// Maratona v2 (engineer loop): trabalho longo por tentativas, com prova do runner e custo por feature aprovada.
// Uso:
//   node maratona.mjs nova <repo> "<objetivo>" --features "t1;t2" | --features-json arq.json [--modelo haiku|sonnet|opus] [--nome x] [--recriar]
//   node maratona.mjs status [repo]
//   node maratona.mjs passo [repo] [--modelo m] [--min 30] [--agendada] [--forcar]
//   node maratona.mjs parar <repo> [--matar] | fim <repo> [motivo]
//   node maratona.mjs retomar <repo>
//   node maratona.mjs ficha <arquivos…> [--foco x] | custos [repo] | biblioteca
// Estado: <repo>/.maratona (feature_list.json, progresso.md, folha-de-provas.md, custos.jsonl); registro, trava e logs em MARATONA_HOME.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { caminhos, ErroEstado, linhaDiario, hoje } from './maratona/lib/estado.mjs';
import { ORDEM } from './maratona/lib/roteador.mjs';
import { traduzir } from './maratona/lib/tradutor.mjs';
import { resumo, custoDia } from './maratona/lib/custos.mjs';
import { ehRepoGit, salvarPatch, reverter, ramoAtual, head } from './maratona/lib/repo.mjs';
import { lerJournal, apagarJournal } from './maratona/lib/execucao.mjs';
import { matarArvore, conferirTurno } from './maratona/lib/modelo.mjs';
import { registrarParada, apagarParada, estadoDoRegistro } from './maratona/lib/registro.mjs';
import { criarLista, carregarLista, salvarLista, arquivoLista } from './maratona/lib/lista.mjs';
import { textoFalho } from './maratona/lib/portaoFinal.mjs';
import { disparo, criarDeps, carregarRegistro, salvarRegistro, acharNoRegistro, limites } from './maratona/lib/ciclo.mjs';

class ErroUso extends Error {}
const normal = p => path.resolve(p).replaceAll('\\', '/');
const usd = n => `US$ ${(n ?? 0).toFixed(4)}`;

function parseArgs(args, comValor = []) {
  const flags = {}, pos = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    flags[a.slice(2)] = comValor.includes(a.slice(2)) ? args[++i] : true;
  }
  return { pos, flags };
}

function modeloValido(valor) {
  if (valor != null && !ORDEM.includes(valor)) throw new ErroUso(`modelo inválido: ${valor} (use ${ORDEM.join('|')})`);
  return valor ?? null;
}

function lerFeatures({ features, 'features-json': arquivo }) {
  if (features) return String(features).split(';').map(s => s.trim()).filter(Boolean);
  if (!arquivo) return [];
  const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  return Array.isArray(dados) ? dados : dados.features;
}

function cmdNova({ pos, flags }, saida) {
  const [repoArg, objetivo] = pos;
  const uso = 'uso: nova <repo> "<objetivo>" --features "t1;t2;t3" | --features-json arq.json [--modelo m] [--nome x] [--recriar]';
  if (!repoArg || !objetivo) throw new ErroUso(uso);
  const repo = normal(repoArg), modelo = modeloValido(flags.modelo);
  if (!fs.existsSync(repo) || !ehRepoGit(repo)) throw new ErroUso(`o repo precisa ser git com ao menos um commit: ${repo}`);
  const features = lerFeatures(flags);
  if (!Array.isArray(features) || !features.length) throw new ErroUso(`nada para decompor. ${uso}`);
  if (fs.existsSync(arquivoLista(repo)) && !flags.recriar) throw new ErroUso('.maratona já existe neste repo (use --recriar para sobrescrever).');
  const nome = flags.nome || path.basename(repo).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const reg = carregarRegistro();
  const dono = reg.ativas[nome];
  if (dono && normal(dono.repo).toLowerCase() !== repo.toLowerCase() && !flags.recriar) throw new ErroUso(`o nome "${nome}" já pertence a outro repo (use --nome).`);
  let lista;
  try { lista = criarLista({ objetivo, repo, nome, features, modelo }); } catch (e) { throw new ErroUso(e.message); }
  salvarLista(repo, lista);
  fs.writeFileSync(path.join(repo, '.maratona', 'progresso.md'), `# Progresso — ${objetivo}\n\n> Cada tentativa acrescenta uma entrada; nunca reescrever as anteriores.\n`);
  const agora = new Date().toISOString();
  // Um repo tem uma lista só: maratona antiga do mesmo repo sai do registro, senão passo <repo> resolve a errada.
  const outras = Object.fromEntries(Object.entries(reg.ativas).filter(([, m]) => normal(m.repo).toLowerCase() !== repo.toLowerCase()));
  salvarRegistro({ ...reg, ativas: { ...outras, [nome]: { nome, repo, objetivo, modelo, criada_em: agora, atualizada_em: agora, passos_hoje: 0,
    ultimo_dia: hoje(), ultimo_passo_em: null, custo_total_usd: 0, status: 'ativa' } } });
  const semPlano = lista.features.filter(f => f.estado === 'precisa_plano').length;
  linhaDiario(`Maratona criada "${nome}" em ${repo}: ${objetivo} (${lista.features.length} features, cota ${limites().maxPassosDia} tentativas/dia).`);
  saida(`maratona "${nome}" criada: ${lista.features.length} features${semPlano ? ` (${semPlano} sem verificação: o primeiro passo roda o plano)` : ''}. Próximo: node maratona.mjs passo ${repo}`);
}

function statusDoRepo(repo, saida) {
  const { lista } = carregarLista(normal(repo));
  const feitas = lista.features.filter(f => f.estado === 'aprovada').length;
  saida(`${lista.objetivo}\nrepo: ${lista.repo}\nfeitas: ${feitas}/${lista.features.length}`);
  const alvo = acharNoRegistro(carregarRegistro(), repo);
  saida(`estado: ${alvo ? estadoDoRegistro(alvo) : (feitas === lista.features.length ? 'concluida' : 'ativa')}`);
  for (const f of lista.features) {
    saida(`  ${f.id} [${f.estado}] ${f.titulo} — tentativas ${f.tentativas.length}, ${usd(f.custo_usd)}${f.motivo ? ` — ${f.motivo}` : ''}`);
  }
  for (const falho of lista.portao_final?.ok === false ? lista.portao_final.falhos ?? [] : []) saida(`  ${textoFalho(falho)}`);
  try {
    const r = resumo(normal(repo));
    saida(`custo total ${usd(r.custoTotalUsd)}; por feature aprovada ${r.custoPorFeatureAprovada == null ? 'n/d' : usd(r.custoPorFeatureAprovada)}`);
  } catch (e) { saida(`custos indisponíveis: ${e.message}`); }
}

function cmdStatus({ pos }, saida) {
  if (pos[0]) return statusDoRepo(pos[0], saida);
  const ativas = Object.values(carregarRegistro().ativas);
  if (!ativas.length) return saida('nenhuma maratona registrada');
  for (const r of ativas) {
    saida(`estado: ${estadoDoRegistro(r)}`);
    let feitas = '?', total = '?';
    try { const { lista } = carregarLista(r.repo); feitas = lista.features.filter(f => f.estado === 'aprovada').length; total = lista.features.length; } catch { /* repo sumiu */ }
    saida(`[${estadoDoRegistro(r)}] ${r.nome} — ${r.repo} | ${feitas}/${total} | tentativas hoje ${r.passos_hoje}/${limites().maxPassosDia} | ${usd(r.custo_total_usd)}${r.status === 'parada_bloqueada' && r.motivo_parada ? ` | ${r.motivo_parada}` : ''}`);
  }
}

async function mudarStatus(pos, status, rotulo, saida, matar = false) {
  if (!pos[0]) throw new ErroUso(`uso: ${rotulo} <repo>`);
  const reg = carregarRegistro(), alvo = acharNoRegistro(reg, pos[0]);
  if (!alvo) throw new ErroUso(`maratona não registrada: ${normal(pos[0])}`);
  const em = new Date().toISOString();
  registrarParada(alvo, em);
  salvarRegistro({ ...reg, ativas: { ...reg.ativas, [alvo.nome]: { ...alvo, status, atualizada_em: em, parada_solicitada_em: em } } });
  linhaDiario(`Maratona "${alvo.nome}" em ${alvo.repo} marcada como ${status}${pos.length > 1 ? ` (${pos.slice(1).join(' ')})` : ''}.`);
  saida(`${rotulo}: ${alvo.nome}`);
  if (matar) {
    const j = lerJournal(alvo.nome);
    if (!j?.pid_turno) { saida('nenhum PID de turno registrado; pedido de parada mantido.'); return; }
    if (normal(j.repo).toLowerCase() !== normal(alvo.repo).toLowerCase()) throw new ErroEstado('Journal aponta para outro repo; encerramento recusado.');
    const motivo = await conferirTurno(j);
    if (motivo) { saida(`encerramento recusado: ${motivo}; pedido de parada mantido.`); return; }
    const erro = await matarArvore(j.pid_turno);
    if (erro) throw new Error(erro);
    saida(`turno encerrado (pid ${j.pid_turno}); filhos incluídos.`);
    // Runner vivo guarda patch e custo ao receber o close. Órfão é preservado antes do reset.
    let runnerVivo = false;
    if (Number.isSafeInteger(j.pid_runner) && j.pid_runner > 0) {
      try { process.kill(j.pid_runner, 0); runnerVivo = true; } catch (e) { if (e.code !== 'ESRCH') throw e; }
    }
    if (!runnerVivo) {
      if (head(alvo.repo) !== j.base) { saida('nada preservado: HEAD ≠ base; commit e journal mantidos.'); return; }
      if (!j.branch?.startsWith('maratona/') || ramoAtual(alvo.repo) !== j.branch) {
        saida('nada preservado: branch atual difere da branch maratona/* do journal; journal mantido.'); return;
      }
      const patch = path.join(caminhos().logs, `patch-${alvo.nome}-${j.featureId}-parada-${Date.now()}.patch`);
      salvarPatch(alvo.repo, j.base, patch);
      saida(`patch preservado: ${patch}`);
      reverter(alvo.repo, j.base, j.branch);
      apagarJournal(alvo.nome);
    }
  }
}

function cmdRetomar({ pos }, saida) {
  if (!pos[0]) throw new ErroUso('uso: retomar <repo>');
  const reg = carregarRegistro(), alvo = acharNoRegistro(reg, pos[0]);
  if (!alvo) throw new ErroUso(`maratona não registrada: ${normal(pos[0])}`);
  if (alvo.status === 'encerrada_manual') throw new ErroUso('Maratona encerrada definitivamente por fim; use nova --recriar.');
  apagarParada(alvo.nome);
  salvarRegistro({ ...reg, ativas: { ...reg.ativas, [alvo.nome]: { ...alvo, status: 'ativa', parada_solicitada_em: null,
    atualizada_em: new Date().toISOString() } } });
  linhaDiario(`Maratona "${alvo.nome}" em ${alvo.repo} retomada.`);
  saida(`retomar: ${alvo.nome}`);
}

async function cmdFicha({ pos, flags }, deps, saida) {
  if (!pos.length) throw new ErroUso('uso: ficha <arquivos…> [--foco x]');
  const fontes = pos.map(arquivo => ({ id: arquivo, texto: fs.readFileSync(arquivo, 'utf8') }));
  const r = await traduzir({ fontes, foco: flags.foco, tipo: 'ficha', biblioteca: deps.biblioteca,
    chamarModelo: args => deps.chamarModelo({ ...args, cwd: process.cwd() }) });
  saida(r.ficha);
  saida(`\norigem: ${r.origem} | tokens ${r.tokensAntes} → ${r.tokensDepois} | custo ${usd(r.custoUsd)}`);
}

function cmdCustos({ pos }, saida) {
  if (pos[0]) return saida(JSON.stringify(resumo(normal(pos[0])), null, 2));
  const { home } = caminhos();
  saida(`custo de hoje (todas as maratonas): ${usd(custoDia(home, hoje()))}`);
  for (const r of Object.values(carregarRegistro().ativas)) saida(`${r.nome}: ${usd(resumo(r.repo).custoTotalUsd)}`);
}

function cmdBiblioteca(deps, saida) {
  const e = deps.biblioteca.estatisticas();
  saida(`fichas ${e.fichas} | acertos ${e.acertos} | erros ${e.erros} | taxa ${(e.taxaAcerto * 100).toFixed(0)}% | tokens evitados ${e.tokensEvitados} | custo ${usd(e.custoUsd)}`);
}

function opPasso({ pos, flags }, saida) {
  const limiteMin = flags.min ? Number(flags.min) : 30;
  if (!Number.isFinite(limiteMin) || limiteMin < 1) throw new ErroUso('--min inválido');
  return { repo: pos[0] ? normal(pos[0]) : null, agendada: !!flags.agendada, forcar: !!flags.forcar,
    modelo: modeloValido(flags.modelo), limiteMin: Math.max(5, limiteMin), saida };
}

export function logAgendado(msg) {
  try {
    const { logs } = caminhos();
    fs.mkdirSync(logs, { recursive: true });
    fs.appendFileSync(path.join(logs, `agendada-${hoje()}.log`), `${new Date().toISOString()} ${msg}\n`);
  } catch { /* log é melhor esforço */ }
}

// Devolve o código de saída. Modo agendado nunca derruba o Task Scheduler: o erro vai para o log.
export async function executarCli(argv, { saida = console.log, deps } = {}) {
  const [cmd, ...args] = argv;
  const agendada = args.includes('--agendada');
  try {
    const a = parseArgs(args, ['features', 'features-json', 'modelo', 'nome', 'min', 'foco']);
    switch (cmd) {
      case 'nova': cmdNova(a, saida); break;
      case 'status': cmdStatus(a, saida); break;
      case 'passo': await disparo(opPasso(a, saida), deps ?? criarDeps()); break;
      case 'parar': await mudarStatus(a.pos, 'parada', 'parar', saida, !!a.flags.matar); break;
      case 'retomar': cmdRetomar(a, saida); break;
      case 'fim': await mudarStatus(a.pos, 'encerrada_manual', 'fim', saida); break;
      case 'ficha': await cmdFicha(a, deps ?? criarDeps(), saida); break;
      case 'custos': cmdCustos(a, saida); break;
      case 'biblioteca': cmdBiblioteca(deps ?? criarDeps(), saida); break;
      default: saida('uso: node maratona.mjs <nova|status|passo|parar|retomar|fim|ficha|custos|biblioteca> …'); return cmd ? 2 : 1;
    }
    return 0;
  } catch (e) {
    if (e instanceof ErroUso) { saida(e.message); return 2; }
    saida(`erro${e instanceof ErroEstado ? ' de estado (nada foi sobrescrito)' : ''}: ${e.message}`);
    return agendada ? 0 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const agendada = process.argv.includes('--agendada');
  process.exitCode = await executarCli(process.argv.slice(2), { saida: agendada ? logAgendado : console.log });
}
