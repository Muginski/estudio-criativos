import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { executarCli } from '../../maratona.mjs';
import { criarDeps, carregarRegistro, salvarRegistro } from '../lib/ciclo.mjs';
import { carregarLista, salvarLista } from '../lib/lista.mjs';
import { abrirJournal, atualizarJournal, lerJournal, arquivoJournal } from '../lib/execucao.mjs';
import { reconciliar } from '../lib/reconciliar.mjs';
import { reverter, desfazerCommit } from '../lib/repo.mjs';
import { traduzirComCusto } from '../lib/fichas.mjs';
import { criarBiblioteca } from '../lib/biblioteca.mjs';

const root = 'F:/dev/maratona-codex-smoke';
const report = path.resolve('reports/maratona-codex-20261110/runtime/smoke');
const run = `${Date.now()}-${process.pid}`;
// Node --test impede outro --test herdando este marcador; as provas precisam rodar de verdade.
delete process.env.NODE_TEST_CONTEXT;
process.env.MARATONA_CODEX_EXE = process.execPath;
process.env.MARATONA_CODEX_SCRIPT = path.resolve('.claude/scripts/maratona/tests/codex-fixture.mjs');
const git = (repo, ...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const config = ['--provider', 'codex', '--modelo', 'gpt-6.1-sol', '--esforco', 'high'];
const outputs = [];
async function cli(args, deps) {
  const lines = [];
  const code = await executarCli(args, { saida: line => lines.push(line), deps });
  outputs.push({ args, code, lines });
  fs.writeFileSync(path.join(report, `commands-${run}.json`), JSON.stringify(outputs, null, 2));
  return { code, lines };
}
async function setup(name, { green = false, plan = false } = {}) {
  const repo = path.join(root, `${run}-${name}`);
  assert(path.resolve(repo).startsWith(path.resolve(root) + path.sep));
  assert(fs.existsSync(root), 'Extensão técnica do maestro deve existir');
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  const runtime = path.join(report, `${run}-${name}`);
  fs.mkdirSync(runtime, { recursive: true });
  process.env.MARATONA_HOME = path.join(runtime, 'home');
  process.env.MARATONA_DIARIO = path.join(runtime, 'DIARIO.md');
  process.env.MARATONA_BIBLIOTECA = path.join(runtime, 'biblioteca');
  for (const key of ['MARATONA_TETO_FEATURE_USD', 'MARATONA_MAX_PASSOS_DIA', 'MARATONA_TETO_DIA_USD']) delete process.env[key];
  fs.writeFileSync(path.join(repo, 'value.mjs'), `export const value = ${green ? 42 : 0};\n`);
  fs.writeFileSync(path.join(repo, 'tests/value.test.mjs'), "import assert from 'node:assert/strict'; import { value } from '../value.mjs'; assert.equal(value, 42);\n");
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'Maratona Fixture');
  git(repo, 'config', 'user.email', 'fixture@example.invalid');
  git(repo, 'config', 'core.autocrlf', 'false');
  fs.mkdirSync(path.join(repo, 'empty-hooks'));
  git(repo, 'config', 'core.hooksPath', path.join(repo, 'empty-hooks'));
  git(repo, 'add', '.'); git(repo, 'commit', '-m', 'fixture base');
  const features = path.join(runtime, 'features.json');
  fs.writeFileSync(features, JSON.stringify([{ id: 'F1', titulo: 'corrigir value', arquivos: ['value.mjs'], ...(plan ? {} : { verificacao: ['node --test tests/value.test.mjs'] }) }]));
  assert.equal((await cli(['nova', repo, 'fixture', '--nome', name, '--features-json', features, ...config])).code, 0);
  const trace = path.join(runtime, 'calls.jsonl');
  process.env.MARATONA_FIXTURE = JSON.stringify({ edit: path.join(repo, 'value.mjs'), trace });
  return { repo, runtime, trace, name, feature: () => carregarLista(repo).lista.features[0] };
}

test('ciclo real do runner: prova vermelha, executor Codex, sessão independente e commit provado', async () => {
  const s = await setup('success');
  assert.equal((await cli(['passo', s.repo])).code, 0);
  const f = s.feature();
  assert.equal(f.estado, 'aprovada'); assert.equal(f.passes, true);
  assert(f.base_vermelha); assert.equal(f.tentativas[0].esforco, 'high');
  const calls = fs.readFileSync(s.trace, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 2);
  assert(calls[0].args.includes('workspace-write'));
  assert(calls[1].args.includes('read-only'));
  assert(calls.every(c => c.args.includes('gpt-6.1-sol') && c.args.includes('model_reasoning_effort="high"')));
  assert(!lerJournal(s.name));
  assert.equal(git(s.repo, 'branch', '--show-current'), 'maratona/success');
  assert.equal(git(s.repo, 'status', '--porcelain'), '');
  const costs = fs.readFileSync(path.join(s.repo, '.maratona/custos.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert(costs.filter(c => c.etapa !== 'aprovacao').every(c => c.custoUsd > 0 && c.estimado === true));
  assert(costs.some(c => c.threadId === 'fixture-thread' && c.modelo === 'gpt-6.1-sol'));
});

test('prova verde na base não chama executor nem aprova', async () => {
  const s = await setup('green', { green: true });
  await cli(['passo', s.repo]);
  assert.equal(s.feature().passes, false); assert.equal(s.feature().estado, 'bloqueada');
  assert(!fs.existsSync(s.trace));
});

test('guard de sujeira preserva arquivo e não chama executor', async () => {
  const s = await setup('dirty');
  fs.writeFileSync(path.join(s.repo, 'owner.txt'), 'trabalho alheio');
  await cli(['passo', s.repo]);
  assert.equal(fs.readFileSync(path.join(s.repo, 'owner.txt'), 'utf8'), 'trabalho alheio');
  assert(!fs.existsSync(s.trace));
});

test('integridade reverte alteração em teste e guarda patch só na branch própria', async () => {
  const s = await setup('integrity');
  const file = path.join(s.repo, 'tests/value.test.mjs'), original = fs.readFileSync(file, 'utf8');
  process.env.MARATONA_FIXTURE = JSON.stringify({ edit: file, content: '// enfraquecido\n', trace: s.trace });
  await cli(['passo', s.repo]);
  assert.equal(s.feature().tentativas[0].tipo, 'integridade');
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert(fs.existsSync(s.feature().tentativas[0].patch));
  assert.equal(s.feature().proximo_esforco, 'xhigh');
  assert.equal(s.feature().passes, false);
});

test('falha do executor conta infra sem perder custo nem esforço e desfaz edição', async () => {
  const s = await setup('infra');
  process.env.MARATONA_FIXTURE = JSON.stringify({ edit: path.join(s.repo, 'value.mjs'), events: [{ type: 'turn.failed', error: { message: 'stub failure' } }] });
  await cli(['passo', s.repo]);
  assert.equal(s.feature().tentativas[0].tipo, 'infra');
  assert(s.feature().custo_usd > 0);
  assert.equal(fs.readFileSync(path.join(s.repo, 'value.mjs'), 'utf8'), 'export const value = 0;\n');
});

test('revisor indisponível guarda código, passes falso, sem se autoaprovar', async () => {
  const s = await setup('review');
  process.env.MARATONA_FIXTURE = JSON.stringify({ edit: path.join(s.repo, 'value.mjs'), review: 'INDISPONIVEL' });
  await cli(['passo', s.repo]);
  assert.equal(s.feature().estado, 'aguardando_prova'); assert.equal(s.feature().passes, false);
  const trace = path.join(s.runtime, 'retry.jsonl');
  process.env.MARATONA_FIXTURE = JSON.stringify({ trace });
  await cli(['passo', s.repo, '--forcar']);
  assert.equal(s.feature().estado, 'aprovada');
  assert.equal(s.feature().tentativas.at(-1).modelo, 'gpt-6.1-sol');
  assert.equal(s.feature().tentativas.at(-1).esforco, 'high');
  const calls = fs.readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 1); assert(calls[0].args.includes('read-only'));
});

test('revisor reprova: preserva achados, guarda patch, desfaz código e não aprova', async () => {
  const s = await setup('rejected');
  process.env.MARATONA_FIXTURE = JSON.stringify({ edit: path.join(s.repo, 'value.mjs'), review: 'REPROVADO', achados: [{ severidade: 'media', arquivo: 'value.mjs', evidencia: 'fixture finding', correcao: 'corrigir' }] });
  await cli(['passo', s.repo]);
  assert.equal(s.feature().tentativas[0].tipo, 'revisao'); assert.equal(s.feature().passes, false);
  assert(s.feature().achados.some(a => a.includes('fixture finding')));
  assert.equal(fs.readFileSync(path.join(s.repo, 'value.mjs'), 'utf8'), 'export const value = 0;\n');
});

test('plano usa Codex medium e valida sua prova na base', async () => {
  const s = await setup('plan', { plan: true });
  await cli(['passo', s.repo]);
  assert.equal(s.feature().estado, 'pendente');
  assert(s.feature().base_vermelha);
  const calls = fs.readFileSync(s.trace, 'utf8').trim().split('\n').map(JSON.parse);
  assert(calls.every(c => c.args.includes('read-only') && c.args.includes('gpt-6.1-sol') && c.args.includes('model_reasoning_effort="medium"')));
});

test('teto financeiro e cota diária impedem chamadas', async () => {
  const s = await setup('limits');
  process.env.MARATONA_TETO_FEATURE_USD = '0';
  await cli(['passo', s.repo]); assert(!fs.existsSync(s.trace));
  delete process.env.MARATONA_TETO_FEATURE_USD;
  const t = await setup('quota');
  process.env.MARATONA_MAX_PASSOS_DIA = '0';
  await cli(['passo', t.repo]); assert(!fs.existsSync(t.trace));
  const u = await setup('daily-budget');
  process.env.MARATONA_TETO_DIA_USD = '0';
  await cli(['passo', u.repo, '--forcar']); assert(!fs.existsSync(u.trace));
});

test('journal queda: patch, rollback e custo conservador, sem duplicar recuperação', async () => {
  const s = await setup('recovery');
  git(s.repo, 'checkout', '-b', 'maratona/recovery');
  git(s.repo, 'add', '.maratona'); git(s.repo, 'commit', '-m', 'fixture state');
  const base = git(s.repo, 'rev-parse', 'HEAD');
  abrirJournal(s.name, { repo: s.repo, branch: 'maratona/recovery', base, featureId: 'F1', tentativa: 1, modelo: 'gpt-6.1-sol', esforco: 'xhigh', provider: 'codex', reservaUsd: 0.3, fase: 'turno' });
  fs.writeFileSync(path.join(s.repo, 'value.mjs'), 'export const value = 17;\n');
  const ctx = { nome: s.name, repo: s.repo, deps: criarDeps(), op: {}, saida: () => {} };
  assert.equal((await reconciliar(ctx)).ok, true);
  assert.equal(s.feature().tentativas[0].esforco, 'xhigh');
  assert.equal(s.feature().custo_usd, 0.3);
  assert.equal(fs.readFileSync(path.join(s.repo, 'value.mjs'), 'utf8'), 'export const value = 0;\n');
  await reconciliar(ctx); assert.equal(s.feature().tentativas.length, 1);
});

test('journal ilegível e branch alheia ficam intactos', async () => {
  const s = await setup('foreign');
  const base = git(s.repo, 'rev-parse', 'HEAD');
  assert.throws(() => reverter(s.repo, base, 'maratona/foreign'));
  assert.throws(() => desfazerCommit(s.repo, base));
  assert.equal(git(s.repo, 'branch', '--show-current'), 'main');
  const file = arquivoJournal(s.name);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '{broken');
  assert.throws(() => lerJournal(s.name)); assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});

test('tradutor Codex low registra cada uso e não desconta custo duas vezes', async () => {
  const s = await setup('translator');
  let saldo = 0.2, calls = [];
  const events = [];
  const biblioteca = criarBiblioteca({ dir: path.join(s.runtime, 'biblio-test') });
  await traduzirComCusto({ repo: s.repo, deps: { biblioteca, execucao: { provider: 'codex' }, chamarModelo: async args => {
    calls.push(args); return { code: 0, resultado: 'ficha inválida', custoUsd: null, custoEstimadoUsd: 0.05, esforco: 'low' };
  } }, lancar: e => { events.push(e); saldo -= e.custoUsd; }, featureId: 'F1', n: 1, etapa: 'tradutor', saldo: () => saldo,
  fontes: [{ id: 'large', texto: Array.from({ length: 200 }, (_, i) => `export function value${i}() { return ${i}; }`).join('\n') }], foco: 'value', tipo: 'teste', limiteTokens: 20 });
  assert(calls.length > 0); assert(events.every(e => e.modelo === 'gpt-6.1-sol' && e.esforco === 'low'));
  assert(calls.every(c => c.modelo === 'gpt-6.1-sol' && c.esforco === 'low'));
  if (calls.length === 2) assert(Math.abs(calls[1].tetoUsd - 0.15) < 1e-9);
});

test('lista legada sem provider falha fechada sem chamar Claude', async () => {
  const s = await setup('legacy');
  const list = carregarLista(s.repo).lista; delete list.execucao; salvarLista(s.repo, list);
  assert.notEqual((await cli(['passo', s.repo])).code, 0);
  assert(!fs.existsSync(s.trace));
});

test('flag sem valor e Astra inicial são rejeitados antes de criar estado', async () => {
  const s = await setup('invalid-cli');
  assert.equal((await cli(['passo', s.repo, '--esforco'])).code, 2);
  const result = await cli(['nova', s.repo, 'invalid', '--features', 'x', '--provider', 'codex', '--modelo', 'gpt-6-astra', '--esforco', 'high', '--recriar']);
  assert.notEqual(result.code, 0);
  assert.equal(carregarLista(s.repo).lista.execucao.modelo, 'gpt-6.1-sol');
});
