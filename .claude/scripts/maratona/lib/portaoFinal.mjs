// Portão final (R6): o comando que o E-5 adiou numa feature aprovada continua DEVIDO até alguém rodá-lo na árvore final.
// Antes de qualquer caminho que marque a maratona `concluida` ou `parada_bloqueada` (aprovação da última feature, fechamento sem
// trabalho, reconciliação), o runner roda uma vez, sem modelo, a união dos `adiados` das features aprovadas. Vale mesmo que a
// feature que seria o portão tenha saído da lista. Falhou algum: nunca `concluida`.
import { rodarVerificacao, normalizarComandos } from './prova.mjs';
import { git, head, ramoAtual, sujeira, limparContaminacao, commitarEstado } from './repo.mjs';
import { abrirJournal, apagarJournal } from './execucao.mjs';
import { carregarLista, salvarLista } from './lista.mjs';
import { tocarRegistro, paradaSolicitada } from './registro.mjs';
import { linhaDiario } from './estado.mjs';
import { chaveComando } from './portao.mjs';
import { folha, progresso } from './veredito.mjs';

// comando → ids das features aprovadas que o adiaram
export function devidos(lista) {
  const mapa = new Map();
  for (const f of lista.features) {
    if (f.estado === 'aprovada') for (const cmd of f.adiados ?? []) mapa.set(cmd, [...(mapa.get(cmd) ?? []), f.id]);
  }
  return mapa;
}

export const SENTINELA = 'PORTAO'; // featureId do journal do portão final: não é uma feature da lista
export const textoFalho = ({ cmd, por }) => `portão NÃO PASSOU: ${cmd} (adiado por ${por.join(', ')})`;

// Último commit que mexeu em código (fora de .maratona): commits de estado não invalidam o resultado guardado.
const commitDeCodigo = repo => git(repo, ['log', '-1', '--format=%H', '--', '.', ':(exclude).maratona']).trim();
const mesmos = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Portões ainda devidos que dizem respeito a uma feature (para o aviso de bloqueio).
export function portoesPendentes(c, feature) {
  try {
    const meus = new Set(normalizarComandos(feature.verificacao).map(x => chaveComando(x.cmd)));
    return [...devidos(carregarLista(c.repo).lista)].filter(([cmd]) => meus.has(chaveComando(cmd)))
      .map(([cmd, por]) => `portão pendente: ${cmd} (adiado por ${por.join(', ')})`);
  } catch { return []; }
}

function registrarResultado(c, { commit, comandos, prova, falhos }) {
  const ok = falhos.length === 0;
  salvarLista(c.repo, { ...carregarLista(c.repo).lista, portao_final: { commit, ok, comandos, falhos, em: new Date().toISOString() } });
  const linhas = prova.itens.map(i => `- \`${i.cmd}\` → código ${i.code}`);
  folha(c.repo, `Portão final (código em ${commit.slice(0, 7)}): ${ok ? 'passou' : 'NÃO PASSOU'}\n${linhas.join('\n')}`);
  progresso(c.repo, `Portão final — ${ok ? 'passou' : 'NÃO PASSOU'}`, [...linhas, ...falhos.map(textoFalho)]);
  commitarEstado(c.repo, 'chore(maratona): portão final');
}

// { ok, falhos, rodou } | { suja: true } quando a árvore tem trabalho do dono (nada é rodado nem limpo).
export async function portaoFinal(c) {
  const mapa = devidos(carregarLista(c.repo).lista);
  if (!mapa.size) return { ok: true, falhos: [], rodou: false };
  const commit = commitDeCodigo(c.repo), comandos = [...mapa.keys()];
  const anterior = carregarLista(c.repo).lista.portao_final;
  if (anterior?.commit === commit && mesmos(anterior.comandos, comandos)) return { ok: anterior.ok, falhos: anterior.falhos ?? [], rodou: false };
  if (sujeira(c.repo).length) return { suja: true };
  // Journal de fase `portao` (sem reserva e sem cota) ANTES de rodar: uma morte no meio do comando deixa a autoria da sujeira
  // registrada e a reconciliação limpa e apaga, como na fase `base`. O `finally` cobre só o caminho em que o processo sobrevive.
  abrirJournal(c.nome, { tipo: 'feature', fase: 'portao', repo: c.repo, branch: ramoAtual(c.repo), base: head(c.repo), featureId: SENTINELA,
    tentativa: 0, modelo: '-', reservaUsd: 0 });
  let prova;
  try { prova = await rodarVerificacao({ repo: c.repo, comandos, executar: c.deps.executar }); }
  finally { limparContaminacao(c.repo); apagarJournal(c.nome); } // a árvore estava limpa antes: o que a prova gerou é dela
  const falhos = prova.itens.filter(i => i.code !== 0).map(i => ({ cmd: i.cmd, por: mapa.get(i.cmd) ?? [] }));
  if (paradaSolicitada(c.nome)) return { parada: true };
  registrarResultado(c, { commit, comandos, prova, falhos });
  return { ok: falhos.length === 0, falhos, rodou: true };
}

// Único caminho que encerra a maratona. Devolve { status, fechada, passou }.
export async function fecharMaratona(c, { concluida }) {
  if (paradaSolicitada(c.nome)) return { status: 'parada', fechada: false, passou: false };
  const r = await portaoFinal(c);
  if (r.parada || paradaSolicitada(c.nome)) return { status: 'parada', fechada: false, passou: false };
  if (r.suja) {
    c.saida(`[${c.nome}] portão final aguarda a árvore limpa; a maratona não foi encerrada.`);
    return { status: 'ativa', fechada: false, passou: false };
  }
  if (!r.ok) {
    const texto = r.falhos.map(textoFalho).join('; ');
    tocarRegistro(c.nome, () => ({ status: 'parada_bloqueada', motivo_parada: texto }));
    linhaDiario(`Maratona "${c.nome}" PARADA COM BLOQUEIOS em ${c.repo}: ${texto}.`);
    for (const f of r.falhos) c.saida(`[${c.nome}] ${textoFalho(f)}`);
    return { status: 'parada_bloqueada', fechada: true, passou: false };
  }
  const status = concluida ? 'concluida' : 'parada_bloqueada';
  tocarRegistro(c.nome, atual => (atual.status === status ? {} : { status, motivo_parada: undefined }));
  return { status, fechada: true, passou: true };
}
