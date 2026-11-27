// Orçamento compartilhado entre as etapas pagas de uma tentativa e custo nunca zero.
// O gasto das etapas já concluídas fica no journal (fora do repo) até a tentativa fechar; o ledger só recebe depois do veredito.
// Journals de OUTRAS maratonas ainda não resolvidos reservam o teto do dia: gasto conhecido ou reserva, o maior.
import { dentroDoTeto } from './custos.mjs';
import { estimarCustoUsd } from './modelo.mjs';
import { lerJournal, atualizarJournal, listarJournals } from './execucao.mjs';
import { hoje } from './estado.mjs';
import { limites, soma } from './registro.mjs';

const TETO_DIA_PADRAO = 5;

export function pendentesDeOutros(nome) {
  return listarJournals().filter(j => j.nome !== nome).reduce((total, { journal }) => {
    if (!journal) return total + limites().reservaTurnoUsd; // ilegível: consumo desconhecido, reserva cheia
    return total + Math.max(soma(journal.custos ?? []), Number(journal.reservaUsd) || 0);
  }, 0);
}

// Mesmo contrato de custos.dentroDoTeto, com o teto do dia já descontado do que as outras maratonas têm pendente.
export function tetoAgora({ repo, nome, feature }) {
  const bruto = Number(process.env.MARATONA_TETO_DIA_USD ?? TETO_DIA_PADRAO);
  const dia = Number.isFinite(bruto) && bruto >= 0 ? bruto : TETO_DIA_PADRAO;
  return dentroDoTeto({ repo, feature, tetoDiaUsd: Math.max(0, dia - pendentesDeOutros(nome)) });
}

// Quanto ainda pode ser gasto agora: teto (feature e dia) menos o que a tentativa em andamento já consumiu.
export function restanteAgora({ repo, nome, featureId }) {
  const teto = tetoAgora({ repo, nome, feature: featureId });
  const gasto = soma(lerJournal(nome)?.custos ?? []);
  return teto.ok ? Math.max(0, teto.restanteUsd - gasto) : 0;
}

// Evento de custo da etapa: fica na tentativa e no journal, para a queda não perder o que já foi gasto.
export function lancarCusto(s, evento) {
  s.custos.push({ dia: hoje(), ...evento }); // o dia do gasto vai junto: o replay cai no mesmo ledger diário
  atualizarJournal(s.nome, { custos: s.custos });
}

// Custo conhecido entra como veio; desconhecido vira estimativa marcada. Sem usage (turno cortado antes de qualquer
// resposta), estima pelo tamanho do prompt com a tabela do modelo usado. Nunca zero.
export function custoDe(resposta, modelo, entradaTokens) {
  const real = resposta?.custoUsd;
  if (Number.isFinite(real) && real >= 0) return { custoUsd: real };
  const dado = resposta?.custoEstimadoUsd;
  if (Number.isFinite(dado) && dado > 0) return { custoUsd: dado, estimado: true };
  const usage = resposta?.usage && Object.keys(resposta.usage).length ? resposta.usage : { input_tokens: Math.max(1, entradaTokens), output_tokens: 0 };
  return { custoUsd: Math.max(estimarCustoUsd(modelo, usage), 1e-6), estimado: true };
}
