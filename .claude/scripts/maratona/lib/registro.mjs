// Registro global das maratonas (MARATONA_HOME/registro.json), limites por variável de ambiente e contadores da cota.
import path from 'node:path';
import fs from 'node:fs';
import { caminhos, lerJson, gravarJsonAtomico, hoje } from './estado.mjs';

const envNum = (nome, padrao) => (Number.isFinite(Number(process.env[nome])) && process.env[nome] !== '' && process.env[nome] != null ? Number(process.env[nome]) : padrao);
export const limites = () => ({ maxPassosDia: envNum('MARATONA_MAX_PASSOS_DIA', 24), passosPorDisparo: envNum('MARATONA_PASSOS_POR_DISPARO', 3),
  maxProva: envNum('MARATONA_MAX_TENTATIVAS_PROVA', 3), esperaProvaMin: envNum('MARATONA_ESPERA_PROVA_MIN', 30), maxInfra: 3,
  reservaTurnoUsd: envNum('MARATONA_RESERVA_TURNO_USD', 0.5), reservaVerificadorUsd: envNum('MARATONA_RESERVA_VERIFICADOR_USD', 0.10),
  batidaSeg: envNum('MARATONA_BATIDA_SEG', 60) });
export const soma = custos => custos.reduce((t, e) => t + e.custoUsd, 0);
export const agoraIso = () => new Date().toISOString();
export const normal = p => path.resolve(p).replaceAll('\\', '/');
const mesmoRepo = (a, b) => normal(a).toLowerCase() === normal(b).toLowerCase();

export const carregarRegistro = () => lerJson(caminhos().registro, { ativas: {} });
export const salvarRegistro = reg => gravarJsonAtomico(caminhos().registro, reg);
export const acharNoRegistro = (reg, repo) => Object.values(reg.ativas).find(r => mesmoRepo(r.repo, repo));

const arquivoParada = nome => path.join(caminhos().home, 'paradas', `${nome}.json`);
export const registrarParada = (alvo, em) => gravarJsonAtomico(arquivoParada(alvo.nome), { criada_em: alvo.criada_em, solicitada_em: em });
export const apagarParada = nome => fs.rmSync(arquivoParada(nome), { force: true });

function pedidoParada(nome, r) {
  const pedido = lerJson(arquivoParada(nome), null);
  return r?.parada_solicitada_em || (pedido && r?.criada_em === pedido.criada_em ? pedido.solicitada_em : null);
}

export function estadoDoRegistro(r) {
  return pedidoParada(r.nome, r) && r.status !== 'encerrada_manual' ? 'parada' : r.status;
}

export function paradaSolicitada(nome) {
  const r = carregarRegistro().ativas[nome];
  return !!pedidoParada(nome, r) || ['parada', 'encerrada_manual'].includes(r?.status);
}

export class ErroParada extends Error {}
export function conferirParada(nome) {
  if (paradaSolicitada(nome)) throw new ErroParada('Parada solicitada; trabalho preservado sem aprovar.');
}

export function tocarRegistro(nome, mudar) {
  const reg = carregarRegistro(), atual = reg.ativas[nome];
  if (!atual) return;
  const base = atual.ultimo_dia === hoje() ? atual : { ...atual, ultimo_dia: hoje(), passos_hoje: 0 };
  const pedido = pedidoParada(nome, atual);
  salvarRegistro({ ...reg, ativas: { ...reg.ativas, [nome]: { ...base, ...mudar(base), atualizada_em: agoraIso(),
    ...(pedido ? { status: atual.status === 'encerrada_manual' ? 'encerrada_manual' : 'parada', parada_solicitada_em: pedido } : {}) } } });
}

// O passo entra na cota ANTES da chamada paga. O total de custo do registro é derivado da lista (veredito.atualizarRegistro).
export const contarPasso = nome => tocarRegistro(nome, r => ({ passos_hoje: (r.passos_hoje ?? 0) + 1, ultimo_passo_em: agoraIso() }));
