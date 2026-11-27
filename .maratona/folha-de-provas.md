
## 2026-11-27T18:27:14.672Z

<!-- 539d1929-aa7c-45c7-bb63-d94e6784e68d -->
Feature f7-lote-pro APROVADA (tentativa 1, sonnet)
- `npm run build` → código 0 em 8.2s, sha256 725d36df11aa
- `node -e "const s=require('fs').readFileSync('src/tools/resizer.js','utf8');if(!/zip/i.test(s)||!/(formats|formatos)/i.test(s))process.exit(1)"` → código 0 em 0.1s, sha256 e3b0c44298fc

## 2026-11-27T18:32:48.490Z

<!-- 894aa043-2a0a-4f98-aaa8-cf7ca39cbd28 -->
Feature f8-state-backend-free APROVADA (tentativa 1, sonnet)
- `npm run build` → código 0 em 2.2s, sha256 1497f774e5f6
- `node -e "const fs=require('fs'),p=require('path');const w=d=>fs.existsSync(d)?fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?w(p.join(d,e.name)):[p.join(d,e.name)]):[];const t=w('supabase').filter(f=>f.endsWith('.sql')).map(f=>fs.readFileSync(f,'utf8')).join('\n');if(!/usage/i.test(t)||!/activations/i.test(t)||!/function\s+(public\.)?activate/i.test(t)||!/row level security/i.test(t))process.exit(1)"` → código 0 em 0.0s, sha256 e3b0c44298fc
- `node -e "const s=require('fs').readFileSync('src/lib/plan.js','utf8');if(!/supabase/i.test(s)||!/activate/.test(s))process.exit(1)"` → código 0 em 0.0s, sha256 e3b0c44298fc
