# Progresso — Evolucao do Estudio de Criativos pos-MVP (lote/zip + estado em banco + video)

> Cada tentativa acrescenta uma entrada; nunca reescrever as anteriores.

## Plano — 2026-11-27T18:20:27.319Z

- verificação definida para 3 feature(s)

## Tentativa 1 — f7-lote-pro (sonnet) — APROVADA — 2026-11-27T18:27:14.674Z
<!-- 539d1929-aa7c-45c7-bb63-d94e6784e68d -->
- - `npm run build` → código 0 em 8.2s, sha256 725d36df11aa
- `node -e "const s=require('fs').readFileSync('src/tools/resizer.js','utf8');if(!/zip/i.test(s)||!/(formats|formatos)/i.test(s))process.exit(1)"` → código 0 em 0.1s, sha256 e3b0c44298fc

## Tentativa 1 — f8-state-backend-free (sonnet) — APROVADA — 2026-11-27T18:32:49.000Z
<!-- 894aa043-2a0a-4f98-aaa8-cf7ca39cbd28 -->
- - `npm run build` → código 0 em 2.2s, sha256 1497f774e5f6
- `node -e "const fs=require('fs'),p=require('path');const w=d=>fs.existsSync(d)?fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?w(p.join(d,e.name)):[p.join(d,e.name)]):[];const t=w('supabase').filter(f=>f.endsWith('.sql')).map(f=>fs.readFileSync(f,'utf8')).join('\n');if(!/usage/i.test(t)||!/activations/i.test(t)||!/function\s+(public\.)?activate/i.test(t)||!/row level security/i.test(t))process.exit(1)"` → código 0 em 0.0s, sha256 e3b0c44298fc
- `node -e "const s=require('fs').readFileSync('src/lib/plan.js','utf8');if(!/supabase/i.test(s)||!/activate/.test(s))process.exit(1)"` → código 0 em 0.0s, sha256 e3b0c44298fc

## Tentativa 1 — f9-video-legenda (sonnet) — APROVADA — 2026-11-27T18:33:18.664Z
<!-- fde1e8f3-a613-4659-9cba-0e322a98598a -->
- - `node -e "const fs=require('fs');if(!fs.existsSync('server')||!fs.readdirSync('server',{recursive:true}).some(f=>/whisper|caption|legenda/i.test(String(f))))process.exit(1)"` → código 0 em 0.0s, sha256 e3b0c44298fc
- `node -e "const fs=require('fs');const t=fs.readdirSync('server',{recursive:true}).filter(f=>/\.(m?js)$/.test(String(f))).map(f=>fs.readFileSync('server/'+f,'utf8')).join('\n');if(!/whisper/i.test(t)||!/(queue|fila)/i.test(t))process.exit(1)"` → código 0 em 0.1s, sha256 e3b0c44298fc
- `npm run build` → código 0 em 1.4s, sha256 07982764a808
