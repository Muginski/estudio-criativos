import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gravarJsonAtomico, lerJson } from './estado.mjs';

const esperar = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
const inicial = () => ({ acertos: 0, erros: 0, tokensEvitados: 0, custoUsd: 0, usos: {} });

function vivo(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

function liberarAbandonada(trava) {
  try {
    const idade = Date.now() - fs.statSync(trava).mtimeMs;
    let dono;
    try { dono = JSON.parse(fs.readFileSync(trava, 'utf8')); } catch {}
    if ((dono?.pid && !vivo(dono.pid)) || (!dono && idade > 5000)) fs.rmSync(trava, { force: true });
  } catch (e) { if (!['ENOENT', 'EPERM', 'EBUSY'].includes(e.code)) throw e; }
}

function exclusivo(dir, executar) {
  fs.mkdirSync(dir, { recursive: true });
  const trava = path.join(dir, '.indice.lock'), inicio = Date.now();
  let fd;
  while (fd === undefined) {
    try { fd = fs.openSync(trava, 'wx'); }
    catch (e) {
      if (!['EEXIST', 'EPERM', 'EBUSY'].includes(e.code)) throw e;
      if (e.code === 'EEXIST') liberarAbandonada(trava);
      if (Date.now() - inicio > 15000) throw new Error('Tempo esgotado aguardando o índice da biblioteca.');
      esperar();
    }
  }
  try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid })); return executar(); }
  finally { fs.closeSync(fd); fs.rmSync(trava, { force: true }); }
}

function arquivoFicha(dir, chave) {
  if (!/^[a-f0-9]{64}$/.test(chave)) throw new Error('Chave de ficha inválida.');
  return path.join(dir, `${chave}.ficha`);
}

function obterFicha(dir, chave) {
  const arquivo = arquivoFicha(dir, chave);
  try {
    const valor = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    if (typeof valor?.ficha !== 'string' || !valor.meta || typeof valor.meta !== 'object' || Array.isArray(valor.meta)) {
      throw new SyntaxError('Ficha inválida.');
    }
    return { ficha: valor.ficha, meta: valor.meta };
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    if (!(e instanceof SyntaxError)) throw e;
    fs.rmSync(arquivo, { force: true });
    return null;
  }
}

function chaveFicha({ tipo, foco, versao, conteudos }) {
  const ordenados = conteudos.map(({ id, texto }) => [id, texto]);
  ordenados.sort((a, b) => {
    const esquerda = JSON.stringify(a), direita = JSON.stringify(b);
    return esquerda < direita ? -1 : esquerda > direita ? 1 : 0;
  });
  return createHash('sha256').update(JSON.stringify([tipo, foco, versao, ordenados])).digest('hex');
}

function fichas(dir) {
  try { return fs.readdirSync(dir).filter(n => /^[a-f0-9]{64}\.ficha$/.test(n)); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}

function uso(indice, { chave, origem, tokensAntes, tokensDepois, custoUsd }) {
  indice[origem === 'biblioteca' ? 'acertos' : 'erros']++;
  indice.tokensEvitados += Math.max(0, (Number(tokensAntes) || 0) - (Number(tokensDepois) || 0));
  indice.custoUsd += Math.max(0, Number(custoUsd) || 0);
  const anterior = indice.usos[chave]?.quantidade || 0;
  indice.usos[chave] = { quantidade: anterior + 1, ultimo: Date.now() };
}

function podarFichas(dir, indice, maxFichas) {
  if (!Number.isSafeInteger(maxFichas) || maxFichas < 0) throw new Error('Limite de fichas inválido.');
  const nomes = fichas(dir);
  const frequencia = n => indice.usos[n.slice(0, -6)] || { quantidade: 0, ultimo: 0 };
  nomes.sort((a, b) => frequencia(a).quantidade - frequencia(b).quantidade || frequencia(a).ultimo - frequencia(b).ultimo || a.localeCompare(b));
  for (const nome of nomes.slice(0, Math.max(0, nomes.length - maxFichas))) {
    fs.rmSync(path.join(dir, nome), { force: true });
    delete indice.usos[nome.slice(0, -6)];
  }
}

export function criarBiblioteca({ dir }) {
  const arquivoIndice = path.join(dir, 'indice.json');
  const lerIndice = () => {
    try { return lerJson(arquivoIndice, inicial()); }
    catch (e) {
      if (!(e.cause instanceof SyntaxError)) throw e;
      console.warn('Índice da biblioteca corrompido preservado em quarentena; estatísticas reiniciadas.');
      return inicial();
    }
  };
  const alterar = acao => exclusivo(dir, () => {
    const indice = lerIndice(); acao(indice); gravarJsonAtomico(arquivoIndice, indice);
  });
  return {
    chave: chaveFicha,
    obter: chave => exclusivo(dir, () => obterFicha(dir, chave)),
    guardar(chave, { ficha, meta }) {
      if (typeof ficha !== 'string' || !meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('Ficha ou metadados inválidos.');
      alterar(() => gravarJsonAtomico(arquivoFicha(dir, chave), { ficha, meta }));
    },
    registrarUso(evento) { arquivoFicha(dir, evento.chave); alterar(indice => uso(indice, evento)); },
    estatisticas: () => exclusivo(dir, () => {
      const { acertos, erros, tokensEvitados, custoUsd } = lerIndice();
      return { fichas: fichas(dir).length, acertos, erros, taxaAcerto: acertos + erros ? acertos / (acertos + erros) : 0, tokensEvitados, custoUsd };
    }),
    podar({ maxFichas = 2000 } = {}) { alterar(indice => podarFichas(dir, indice, maxFichas)); },
  };
}
