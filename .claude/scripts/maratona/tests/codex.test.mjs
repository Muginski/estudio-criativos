import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import * as modelo from '../lib/modelo.mjs';
import * as router from '../lib/roteador.mjs';
import { criarLista } from '../lib/lista.mjs';

const report = path.resolve('reports/maratona-codex-20261110/runtime/unit');
fs.mkdirSync(report, { recursive: true });
process.env.MARATONA_CODEX_EXE = process.execPath;
process.env.MARATONA_CODEX_SCRIPT = path.resolve('.claude/scripts/maratona/tests/codex-fixture.mjs');
const opts = { prompt: 'implemente', sistema: 'regras', modelo: 'gpt-6.1-sol', esforco: 'high', cwd: report, ferramentas: ['Read', 'Edit'], tetoUsd: 1 };
async function call(cfg = {}, extra = {}) {
  process.env.MARATONA_FIXTURE = JSON.stringify(cfg);
  return modelo.chamarCodex({ ...opts, ...extra });
}

test('Codex executa JSONL até completion e preserva thread, usage e identidade explícita', async () => {
  const capture = path.join(report, 'args.json');
  const out = await call({ capture });
  assert.equal(out.erro, null);
  assert.equal(out.resultado, 'feito ✓');
  assert.equal(out.threadId, 'fixture-thread');
  assert.equal(out.modelo, opts.modelo);
  assert.equal(out.esforco, 'high');
  assert.equal(out.usage.cached_input_tokens, 200);
  assert.equal(out.custoUsd, null);
  assert(out.custoEstimadoUsd > 0);
  const got = JSON.parse(fs.readFileSync(capture));
  assert(got.args.includes('--ignore-user-config'));
  assert(got.args.includes('--ignore-rules'));
  assert(got.args.includes('--ephemeral'));
  assert(got.args.includes('workspace-write'));
  assert(got.args.includes('model_reasoning_effort="high"'));
  assert(got.prompt.includes('regras'));
  assert(!got.args.some(a => /priority|max-budget|ultra/.test(a)));
});

test('leitura do plano/tradutor usa sandbox read-only', async () => {
  const capture = path.join(report, 'read-only.json');
  await call({ capture }, { ferramentas: ['Read'] });
  assert(JSON.parse(fs.readFileSync(capture)).args.includes('read-only'));
});

test('ausência de usage reserva o saldo inteiro, nunca zero', async () => {
  const out = await call({ events: [{ type: 'thread.started', thread_id: 't' }, { type: 'turn.completed' }] });
  assert.equal(out.custoUsd, null);
  assert.equal(out.custoEstimadoUsd, 1);
});

test('cancelamento externo do CLI reprova e preserva reserva desconhecida', async () => {
  const out = await call({ cancel: true });
  assert.notEqual(out.code, 0);
  assert(out.erro);
  assert.equal(out.custoUsd, null);
  assert.equal(out.custoEstimadoUsd, 1);
  assert.equal(out.resultado, null);
});

test('stream truncado, falha explícita, erro e exit não zero são reprovação', async () => {
  for (const cfg of [
    { events: [{ type: 'thread.started', thread_id: 't' }] },
    { events: [{ type: 'turn.failed', error: { message: 'fixture failure' } }] },
    { events: [{ type: 'error', message: 'fixture error' }, { type: 'turn.completed' }] },
    { code: 3 },
    { events: [{ type: 'thread.started', thread_id: 't' }, { type: 'turn.completed' }, { type: 'turn.completed' }] },
    { events: [{ type: 'turn.completed' }] },
  ]) assert((await call(cfg)).erro);
});

test('usage inválido não reduz reserva conservadora', async () => {
  for (const usage of [{}, { input_tokens: -1, output_tokens: 1 }, { input_tokens: 1, output_tokens: 0, cached_input_tokens: 2 }]) {
    const out = await call({ events: [{ type: 'thread.started', thread_id: 't' }, { type: 'turn.completed', usage }] });
    assert.equal(out.custoEstimadoUsd, 1);
  }
});

test('binário ausente falha sem fallback e sem executar fixture', async () => {
  const saved = process.env.MARATONA_CODEX_EXE;
  process.env.MARATONA_CODEX_EXE = path.join(report, 'does-not-exist.exe');
  try { assert.match((await call()).erro, /não encontrado/); }
  finally { process.env.MARATONA_CODEX_EXE = saved; }
});

test('dispatcher exige provider e rota Astra exige histórico de duas falhas', async () => {
  assert.throws(() => modelo.chamarModelo({ ...opts }));
  const config = { provider: 'codex', modelo: router.SOL, esforco: 'high' };
  assert.throws(() => router.rotaCodex({ proximo_modelo: router.ASTRA, proximo_esforco: 'high', tentativas: [] }, config));
  const tentativas = [1, 2].map(() => ({ modelo: router.SOL, esforco: 'xhigh', tipo: 'prova' }));
  assert.deepEqual(router.rotaCodex({ proximo_modelo: router.ASTRA, proximo_esforco: 'high', tentativas }, config), { modelo: router.ASTRA, esforco: 'high' });
  assert.throws(() => router.rotaCodex({ proximo_modelo: router.ASTRA, proximo_esforco: 'high', tentativas: tentativas.map(t => ({ ...t, tipo: 'infra' })) }, config));
});

test('tempo/teto cortam, saldo esgotado não inicia fixture', async () => {
  assert.equal((await call({ hang: true }, { limiteMin: 0.003 })).cortadoPor, 'tempo');
  assert.equal((await call({}, { tetoUsd: 0.000001 })).cortadoPor, 'teto');
  const capture = path.join(report, 'must-not-exist.json');
  assert.equal((await call({ capture }, { tetoUsd: 0 })).cortadoPor, 'teto');
  assert(!fs.existsSync(capture));
});

test('modelo/esforço inválidos não iniciam executor e não há fallback Claude', async () => {
  for (const extra of [{ modelo: 'sonnet' }, { esforco: 'max' }, { esforco: 'ultra' }, { esforco: 'priority' }, { esforco: null }, { modelo: 'gpt-6-astra', esforco: 'xhigh' }]) {
    assert((await call({}, extra)).erro);
  }
});

test('config Codex persiste na lista; Astra inicial e esforço proibido são rejeitados', () => {
  const execucao = { provider: 'codex', modelo: 'gpt-6.1-sol', esforco: 'high' };
  const list = criarLista({ objetivo: 'x', repo: report, nome: 'x', execucao, features: [{ titulo: 'x' }] });
  assert.deepEqual(list.execucao, execucao);
  assert.throws(() => criarLista({ objetivo: 'x', execucao: { ...execucao, esforco: 'max' }, features: ['x'] }));
  assert.throws(() => criarLista({ objetivo: 'x', execucao: { ...execucao, modelo: 'gpt-6-astra' }, features: ['x'] }));
});

test('Sol sobe esforço, repete xhigh duas vezes antes de Astra high e mantém limite', () => {
  const f = { modelo: 'gpt-6.1-sol', tentativas: [] };
  const failure = { modelo: f.modelo, esforco: 'high', tipo: 'prova' };
  assert.equal(router.decidir(f, failure).esforco, 'xhigh');
  const x = { ...failure, esforco: 'xhigh' };
  assert.equal(router.decidir(f, x).modelo, f.modelo);
  const up = router.decidir({ ...f, tentativas: [x] }, { ...x });
  assert.equal(up.modelo, 'gpt-6-astra');
  assert.equal(up.esforco, 'high');
  assert.equal(router.decidir({ ...f, tentativas: [{ ...x }, { ...x }, { ...x }] }, x).acao, 'bloquear');
  assert.equal(router.decidir(f, { ...failure, tipo: 'infra' }).esforco, 'high');
});
