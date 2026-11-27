// Checagem da base nos dois pontos de entrada de feature com verificação: primeiro disparo da maratona e plano.
import { provaNaBase } from './base.mjs';
import { chaveComando } from './portao.mjs';
import { head } from './repo.mjs';
import { carregarLista, salvarLista, verificacaoDoPlano } from './lista.mjs';
import { bloquearProvaVerde, marcarBaseVermelha } from './veredito.mjs';
import { agoraIso } from './registro.mjs';

const falhos = prova => prova.itens.filter(i => i.code !== 0).map(i => chaveComando(i.cmd));
const elegivel = f => f.estado === 'pendente' && f.verificacao?.length && f.refatoracao !== true && !f.base_vermelha;

// Primeiro disparo da maratona: todas as features pendentes com verificação, ainda na base inicial.
// Verde → bloqueada; vermelha → base_vermelha {em, sha, commit, comandos}. Infra fica para a checagem da tentativa.
export async function checarBaseInicial(c) {
  const inicial = carregarLista(c.repo).lista;
  if (inicial.base_checada) return;
  const sha = head(c.repo), em = agoraIso();
  for (const f of inicial.features.filter(elegivel)) {
    const { estado, prova } = await provaNaBase({ repo: c.repo, nome: c.nome, featureId: f.id, verificacao: f.verificacao, deps: c.deps });
    if (estado === 'verde') bloquearProvaVerde(c, f);
    else if (estado === 'vermelha') marcarBaseVermelha(c, f.id, { em, sha, commit: sha, comandos: falhos(prova) });
  }
  salvarLista(c.repo, { ...carregarLista(c.repo).lista, base_checada: { em, sha } });
}

// Plano: a verificação proposta passa pela mesma checagem na hora do plano. Devolve { verdes: Set de ids, vermelhas: Map id → comandos que falharam }.
export async function checarPlanoNaBase({ repo, nome, lista, resposta, deps }) {
  const itens = new Map((Array.isArray(resposta?.features) ? resposta.features : []).map(i => [i?.id, i]));
  const verdes = new Set(), vermelhas = new Map();
  for (const f of lista.features.filter(x => x.estado === 'precisa_plano' && x.refatoracao !== true)) {
    const r = verificacaoDoPlano(itens.get(f.id));
    if (r.erro) continue;
    const { estado, prova } = await provaNaBase({ repo, nome, featureId: f.id, verificacao: r.verificacao, deps });
    if (estado === 'verde') verdes.add(f.id);
    else if (estado === 'vermelha') vermelhas.set(f.id, falhos(prova));
  }
  return { verdes, vermelhas };
}
