# Estúdio de Criativos

Suíte de criativos para quem roda tráfego pago no nicho hot — **imagem e vídeo**. Processo 100% no navegador: nada é enviado a lugar nenhum.

## Rodar
```bash
npm install
cp .env.example .env   # chave Pix (aba Pro) e, opcional, VITE_WHISPER_URL (legendas automáticas)
npm run dev            # http://localhost:5199
```

## Build de produção
```bash
npm run build          # gera dist/ → GitHub Pages publica a cada push
npm run preview        # testa o build em http://localhost:5199
node tests/vlib.mjs    # testes headless das libs puras
```

## Ferramentas
Grátis (isca):
1. **Print → Texto** — OCR PT+EN no aparelho (5/dia)
2. **Fontes & Cloaker de Texto** — 18 estilos Unicode + marca invisível (ilimitado)
3. **Redimensionar imagem** — 9:16 · 4:5 · 1:1 · 16:9 exatos de anúncio (+ lote em ZIP)
4. **Legenda & marca (imagem)** — 6 posições com faixa · tilé diagonal

Pro — suíte de vídeo (R$ 29,90/30 dias, Pix, renovação manual):
5. **Cloaker de criativo** — hash 100% único + imagem por cima com fade + extensão só com a imagem
6. **Limpar metadados** — imagem, vídeo e áudio sem localização/data/aparelho
7. **Legendas** — cola SRT (ou Whisper) e queima letra grande no vídeo
8. **Comprimir vídeo** — menos MB com comparativo antes/depois
9. **Áudio** — extrai a trilha ou mixa a sua por cima
10. **Redimensionar vídeo** — um vídeo, todas as redes (cover ou fundo borrado)
11. **Cortar vídeo** — início e fim, sem perda percebida
12. **Marca em vídeo** — legenda/tilé queimado com prévia ao vivo
13. **Gerador de preview** — borrão/pixelado na parte quente, no todo ou até Xs
14. **Lote** — mesmo tratamento em até 5 vídeos → 1 ZIP
15. **Plano Pro** — Pix copia-e-cola + código de ativação

Detalhes e decisões: `ARCHITECTURE.md` · pendências que exigem dinheiro/conta: `PENDENCIAS-PAGO.md`
