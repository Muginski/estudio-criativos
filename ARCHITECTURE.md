# Arquitetura — Estúdio de Criativos

> MVP entregue 2026-11-27, publicado em https://muginski.github.io/estudio-criativos/ (GitHub Pages). Objetivo: app funcionando hoje; só fica pendente o que exige dinheiro/conta (ver `PENDENCIAS-PAGO.md`). Foco primário: **nicho hot** (discrição como argumento central de venda).

## Decisão central: 100% client-side no MVP
Todo processamento roda no navegador do usuário (Canvas + WASM). Consequências:
- **Custo de servidor = R$ 0** → hosting estático free (GH Pages / CF Pages / Vercel).
- **Privacidade como argumento de venda**: "suas imagens não saem do dispositivo" (rodapé já comunica).
- **Escopo grátis do Rateio Hot serviu de espelho**: eles têm redimensionar/legenda/marca d'água/print/fontes — copiamos o escopo e viramos imagem-first (eles são vídeo-first). Limits deles (5 arquivos, TTL 24h) validaram nosso limite grátis de 5 prints/dia.

## Camadas
```
index.html            shell (topbar, tabs, toast) — sem framework
src/main.js           roteamento por abas + toast + chip de plano
src/lib/plan.js       estado de plano + uso diário (localStorage; esquema pronto p/ espelhar no back)
src/lib/canvas.js     primitivas compartilhadas (loadImage, cover, blur-padding, download)
src/tools/resizer.js  T1 formatos de anúncio 1080×1920 / 1080×1350 / 1080×1080 / 1920×1080
src/tools/watermark.js T2 legenda posicionada (6 posições, faixa) + marca d'água tilé diagonal
src/tools/ocr.js      T3 print→texto tesseract.js (por+eng, WASM, CDN) — gargalo grátis 5/dia
src/tools/fonts.js    T4 18 estilos Unicode p/ copy — grátis ilimitado (isca)
src/tools/pro.js      T5 checkout Pro R$29,90/30d — Pix EMV copia-e-cola gerado no cliente + ativação por código
```
Dependências: `vite` (build) + `tesseract.js` (OCR). Nada além disso.

## Modelo de cobrança (copiado do que funciona no Rateio Hot)
- Grátis atrai: fontes ilimitadas + 5 prints/dia (contador local).
- Pro: **R$ 29,90 a cada 30 dias, one-shot, sem recorrência automática** — renova na mão.
- Pix estático (copia-e-cola) gerado localmente com `VITE_PIX_CHAVE` → **zero custo de gateway hoje**.
- Ativação: código `EC-XXXXXX` emitido pelo dono após conferir pagamento manual (fricção aceitável no MVP; some com webhook).

## Pendência técnica (sem dinheiro, depois)
- Espelhar `ec_state_v1` no banco (Supabase free) → impede reset de localStorage + ativação por webhook.
- OCR offline (bundle local do tesseract) se o público alvo tiver internet fraca.

## Fase 2 (quando houver dinheiro/VPS)
Vídeo: legendas automáticas (Whisper) + corte — fila server-side. Limites RH de referência: 180 s/vídeo, 33 MB.

## Fase 2: legenda automática (server/)
Whisper server-side (`server/whisper.mjs`, provedor via WHISPER_PROVIDER=openai|local) com fila (`server/caption-queue.mjs`). Decisão de custo VPS vs API pendente.

## v2 — Suíte vídeo-first (2026-11-28)
Mineração do rateiohot.com/ferramentas (literal `window.__RH_TL_TOOLS` com as 15 tools + widgets rh-tools/rh-tl-caps) definiu o mapa. App virou **home em grade de ferramentas** (clique abre a tool, deep link por hash) + portão PRO.

| Ferramenta RH | Nossa | Engine no cliente |
|---|---|---|
| print→texto | Print → Texto (OCR) | tesseract.js WASM (grátis 5/dia) |
| fontes + texto (cloaker) | Fontes & Cloaker de Texto | mapa Unicode + marcadores zero-largura |
| redimensionar (img) | Redimensionar imagem | canvas |
| marca (img) | Legenda & marca (imagem) | canvas |
| variacoes | Cloaker de criativo | canvas + captureStream + MediaRecorder |
| limpar | Limpar metadados (img/vídeo/áudio) | re-draw canvas / re-encode / decode→WAV |
| legendas | Legendas | burn de SRT; Whisper via VITE_WHISPER_URL (server/) |
| comprimir | Comprimir vídeo | re-encode com bitrate controlado + comparativo |
| extrair + audio | Áudio (extrair/mixar) | WebAudio → WAV / trilha mixada |
| redimensionar (vídeo) | Redimensionar vídeo | targetSize + cover/fit c/ fundo borrado |
| lote | Lote | receita única × até 5 vídeos → ZIP no cliente |
| cortar | Cortar vídeo | start/end |
| marca (vídeo) | Marca em vídeo | texto/tilé queimado + prévia ao vivo por seek |
| previa | Gerador de preview | região blur/pixelada, opcional só até Xs |
| — | Plano Pro | Pix EMV + código de ativação |

- Todo o processamento de vídeo vive em `src/lib/video.js` — pipeline único (canvas + captureStream + MediaRecorder + WebAudio); cada tool é só um config dele. Limites espelham o RH: 5 arquivos / 33 MB / 180 s (`VIDEO_LIMITS`).
- Decisão de preço: lado imagem continua grátis (já estava público como grátis desde o MVP); **suíte inteira de vídeo = Pro** (R$ 29,90/30 dias, renovação manual). Portão = classes `.locked`/`.gate` aplicadas em main.js e reavaliadas em cada ativação.
- Diferencial mantido vs RH: eles mandam o arquivo pro servidor FFmpeg (TTL 24 h); aqui nada sai do aparelho.
- Prova: `npm run build` + `node tests/vlib.mjs` (parser de legendas, targetSize, ZIP).
