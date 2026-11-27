# Pendências — só o que exige dinheiro ou conta do Dimi

Tudo o mais está pronto e funcionando (`npm run dev`). Esta lista é o que fica com você:

| # | Item | Quanto custa | O que fazer (5 min) | Efeito sem isso |
|---|------|--------------|---------------------|-----------------|
| 1 | **Chave Pix** p/ receber (seu CPF, e-mail ou telefone) | R$ 0 | Colar em `.env` → `VITE_PIX_CHAVE=` (+ `VITE_PIX_NOME`, `VITE_PIX_CIDADE`) e rodar de novo | Aba Pro mostra "chave não configurada"; o resto do app funciona |
| 2 | **Hosting** (escolher uma conta grátis sua) | R$ 0 | Rodar `npm run build` e subir a pasta `dist/` em GitHub Pages / Cloudflare Pages / Netlify (ou me passe acesso que eu subo) | App roda só na sua máquina (`npm run dev`) |
| 3 | **Domínio** (opcional) | ~R$ 40/ano (.com.br) | Registrar e apontar pro hosting | Roda no subdomain gratuito do host |
| 4 | **Gateway automático de Pix** (Asaas ou MercadoPago) — opcional no MVP | conta grátis + taxa por recebimento (~R$ 1–3/pix, cartão ~3–5%) | Criar conta, gerar chave pública + webhook, colar no back quando ele existir | Pagamento continua funcionando manual (Pix copia-e-cola + código de ativação) |
| 5 | **Fase 2 — vídeo** (legendas automáticas/Whisper) | API paga por uso **ou** GPU (RunPod ~R$ 30–250/mês c/ cadência) | Decidir quando o plano Pro estiver com volume | Ferramentas de vídeo entram depois (já previstas no escopo Pro) |

> Regra do produto (fixada): grátis = fontes + 5 prints/dia · pago = R$ 29,90/30 dias, renovação manual, nunca recorrência automática.
