# Pendências — só o que exige dinheiro ou conta do Dimi

Tudo o mais está pronto e **publicado** em https://muginski.github.io/estudio-criativos/ (GitHub Pages, build automático via Actions). Lista do que fica com você:

| # | Item | Quanto custa | O que fazer (5 min) | Efeito sem isso |
|---|------|--------------|---------------------|-----------------|
| 1 | **Chave Pix** p/ receber (seu CPF, e-mail ou telefone) | R$ 0 | Me passa a chave aqui (ou cola em `.env` → `VITE_PIX_CHAVE=`) que eu refaço o build e publico na hora | Aba Pro mostra "chave não configurada"; o resto do app funciona |
| 2 | ~~Hosting~~ | — | **Feito**: GitHub Pages grátis, deploy automático a cada push (`npm run build` + `git push` publica sozinho) | — |
| 3 | **Domínio** (opcional) | ~R$ 40/ano (.com.br) | Registrar e apontar CNAME pra `muginski.github.io` | Roda no `muginski.github.io/estudio-criativos` (funciona, só é menos bonito) |
| 4 | **Projeto Supabase free** (espelho anti-reset do contador + ativação remota do Pro) | R$ 0 | Criar conta em supabase.com → novo projeto → rodar `supabase/migrations/0001_state.sql` no SQL Editor → me passa URL + anon key que eu publico | Contador segue só no aparelho (localStorage); o código já está pronto e degrada sozinho sem isso |
| 5 | **Gateway automático de Pix** (Asaas ou MercadoPago) — opcional no MVP | conta grátis + taxa por recebimento (~R$ 1–3/pix, cartão ~3–5%) | Criar conta, gerar chave pública + webhook, colar no back quando ele existir | Pagamento continua funcionando manual (Pix copia-e-cola + código de ativação) |
| 6 | **Fase 2 — vídeo** (legendas automáticas/Whisper) | API paga por uso **ou** GPU (RunPod ~R$ 30–250/mês c/ cadência) | Decidir quando o plano Pro estiver com volume; o servidor já está escrito em `server/` (fila + Whisper), falta onde hospedar | Ferramentas de vídeo entram depois (já previstas no escopo Pro) |

> Regra do produto (fixada): foco primário = **nicho hot** · grátis = fontes + 5 prints/dia · pago = R$ 29,90/30 dias, renovação manual, nunca recorrência automática.
