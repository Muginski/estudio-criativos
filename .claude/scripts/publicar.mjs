// Pages do Muginski/estudio-criativos: força build_type=workflow + acompanha deploy
import { execSync } from 'node:child_process';
const token = execSync('gh auth token').toString().trim();
const H = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
const R = 'https://api.github.com/repos/Muginski/estudio-criativos';
const P = `${R}/pages`;
const LIVE = 'https://muginski.github.io/estudio-criativos/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let g = await fetch(P, { headers: H });
if (g.status === 200) {
  const b = await g.json();
  console.log('site atual: build_type=', b.build_type, 'status=', b.status);
  if (b.build_type !== 'workflow') {
    await fetch(P, { method: 'DELETE', headers: H });
    console.log('deletado o legacy, esperando assentar…');
    await sleep(8000);
    g = await fetch(P, { headers: H });
    console.log('pos-delete:', g.status);
  }
} else console.log('GET inicial:', g.status);

if ((await fetch(P, { headers: H })).status !== 200) {
  const c = await fetch(P, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ build_type: 'workflow', source: { branch: 'main', path: '/' } }),
  });
  console.log('POST create:', c.status, JSON.stringify(await c.json()).slice(0, 120));
  await sleep(6000);
  const v = await fetch(P, { headers: H });
  console.log('verificação:', v.status, JSON.stringify(await v.json()).slice(0, 120));
}

// dispara e acompanha
await fetch(`${R}/actions/workflows/deploy.yml/dispatches`, {
  method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: 'main' }),
});
console.log('dispatch enviado');

let ultimo = '', done = null;
for (let i = 0; i < 40; i++) {
  await sleep(15000);
  const runs = (await (await fetch(`${R}/actions/runs?per_page=1`, { headers: H })).json()).workflow_runs || [];
  const r = runs[0];
  const st = r ? `${r.name} ${r.status}/${r.conclusion ?? '-'} evento=${r.event} sha=${String(r.head_sha).slice(0, 7)}` : '(sem run)';
  if (st !== ultimo) { console.log(`t=${i * 15}s`, st); ultimo = st; }
  if (r && r.name === 'Deploy p/ GitHub Pages' && r.event === 'workflow_dispatch' && r.status === 'completed') { done = r; break; }
}
if (!done) console.log('⚠ não vi o run do dispatch concluir no tempo');
else if (done.conclusion !== 'success') {
  const jobs = (await (await fetch(`${R}/actions/runs/${done.id}/jobs`, { headers: H })).json()).jobs || [];
  for (const j of jobs) { console.log(`JOB ${j.name}: ${j.conclusion}`); for (const s of j.steps || []) if (s.conclusion === 'failure') console.log('   fail:', s.name); }
} else console.log('✔ run do deploy concluído com sucesso');

for (let i = 0; i < 12; i++) {
  await sleep(15000);
  try {
    const h = await (await fetch(LIVE)).text();
    if (h.includes('assets/index')) { console.log('🟢 LIVE OK', h.length, 'bytes'); process.exit(0); }
    console.log(`propagando… (${h.length} bytes)`);
  } catch (e) { console.log('fetch:', e.message); }
}
console.log('⚠ assets ainda não vistos após ~3 min');
