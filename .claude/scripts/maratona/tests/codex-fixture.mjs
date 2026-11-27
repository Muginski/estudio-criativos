import fs from 'node:fs';

let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
const cfg = JSON.parse(process.env.MARATONA_FIXTURE || '{}');
if (cfg.capture) fs.writeFileSync(cfg.capture, JSON.stringify({ args: process.argv.slice(2), prompt }));
if (cfg.trace) fs.appendFileSync(cfg.trace, JSON.stringify({ args: process.argv.slice(2), prompt }) + '\n');
const review = process.argv.includes('--output-schema');
if (cfg.edit && process.argv.includes('workspace-write')) fs.writeFileSync(cfg.edit, cfg.content ?? 'export const value = 42;\n');
if (cfg.hang) await new Promise(resolve => setTimeout(resolve, 60000));
if (cfg.cancel) process.kill(process.pid, 'SIGTERM');
const text = review ? JSON.stringify({ veredito: cfg.review ?? 'APROVADO', achados: cfg.achados ?? [] }) :
  prompt.includes('Você define a prova') ? JSON.stringify({ features: [{ id: 'F1', verificacao: ['node --test tests/value.test.mjs'] }] }) : 'feito ✓';
const events = cfg.events ?? [
  { type: 'thread.started', thread_id: 'fixture-thread' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { type: 'agent_message', text } },
  { type: 'turn.completed', usage: { input_tokens: 1000, cached_input_tokens: 200, output_tokens: 100 } },
];
for (const [i, event] of events.entries()) process.stdout.write(JSON.stringify(event) + (i === events.length - 1 ? '' : '\n'));
process.exitCode = cfg.code ?? 0;
