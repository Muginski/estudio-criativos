// Comando compartilhado vira portão da última feature (piloto-g): a verificação de F1 incluía a suíte inteira, e a suíte
// continha o teste da F2 ainda pendente, então F1 nunca passaria obedecendo "só esta feature".
// Um comando C de F é ADIADO quando: C está vermelho na base para F; existe outra feature G, depois de F na lista e ainda
// pendente (nem aprovada nem bloqueada), com C vermelho na base; e F continua com ao menos um comando vermelho na base não
// adiado (para sempre sobrar prova real). Sem isso, nada é adiado. Compara o comando normalizado. Função pura.
import { normalizarComandos } from './prova.mjs';

// String exata depois de trim: espaço interno pode estar dentro de aspas e mudar o significado do comando, então nunca é compactado.
// Evitar juntar comandos diferentes vale mais que economizar uma prova.
export const chaveComando = cmd => String(cmd).trim();
const pendente = f => !['aprovada', 'bloqueada'].includes(f.estado);
const vermelhos = f => new Set((f.base_vermelha?.comandos ?? []).map(chaveComando));

export function comandosDaProva(feature, lista) {
  const todos = normalizarComandos(feature.verificacao);
  const posicao = lista?.features?.findIndex(f => f.id === feature.id) ?? -1;
  if (!Array.isArray(feature.base_vermelha?.comandos) || posicao < 0) return { rodar: todos, adiados: [] };
  const meus = vermelhos(feature), seguintes = lista.features.slice(posicao + 1).filter(g => pendente(g) && g.base_vermelha?.comandos);
  const adiados = [];
  for (const c of todos) {
    const chave = chaveComando(c.cmd);
    const portoes = meus.has(chave) ? seguintes.filter(g => vermelhos(g).has(chave)) : [];
    if (portoes.length) adiados.push({ ...c, portao: portoes.at(-1).id });
  }
  const sobra = todos.some(c => meus.has(chaveComando(c.cmd)) && !adiados.some(a => a.cmd === c.cmd));
  return sobra ? { rodar: todos.filter(c => !adiados.some(a => a.cmd === c.cmd)), adiados } : { rodar: todos, adiados: [] };
}

export const textoAdiados = adiados => adiados.map(a => `adiado: ${a.cmd} (portão de ${a.portao})`);

// Mesma informação para a sessão limpa: entradas sem código de saída, marcadas como adiadas.
export const provasAdiadas = adiados => adiados.map(a => ({ comando: a.cmd, adiado: true, portao: a.portao,
  motivo: 'comando compartilhado, vermelho na base; adiado até a última feature que o usa (o portão contra regressão)' }));
