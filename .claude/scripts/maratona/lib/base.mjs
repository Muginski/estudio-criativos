// Prova vermelha na base: antes de gastar com uma feature, a verificação roda com a árvore na base. Verde = a prova não prova nada;
// vermelha = ok. Roda no checkout (com a árvore já confirmada limpa pela guarda): sem node_modules a prova ficaria vermelha falsa
// num worktree. O que a própria verificação sujar é restaurado depois; um journal de fase `base` cobre a queda no meio.
import { rodarVerificacao, normalizarComandos } from './prova.mjs';
import { abrirJournal, apagarJournal } from './execucao.mjs';
import { head, ramoAtual, limparContaminacao } from './repo.mjs';

// Estado: 'verde' | 'vermelha' | 'infra' (código -1 = timeout/erro do comando, não é vermelho).
export async function provaNaBase({ repo, nome, featureId, verificacao, deps }) {
  abrirJournal(nome, { tipo: 'feature', fase: 'base', repo, branch: ramoAtual(repo), base: head(repo), featureId, tentativa: 0, modelo: '-', reservaUsd: 0 });
  try {
    const prova = await rodarVerificacao({ repo, comandos: normalizarComandos(verificacao), executar: deps.executar });
    const estado = prova.itens.some(i => i.code === -1) ? 'infra' : prova.ok ? 'verde' : 'vermelha';
    return { estado, prova };
  } finally { limparContaminacao(repo); apagarJournal(nome); }
}
