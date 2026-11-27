import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const pausa = new Int32Array(new SharedArrayBuffer(4));
const arquivoCustos = repo => path.join(repo, '.maratona', 'custos.jsonl');
const homeCustos = () => process.env.MARATONA_HOME || 'F:/GrupoSip/.brain/work/maratona';
const transitorio = erro => ['EEXIST', 'EPERM', 'EBUSY', 'EACCES', 'ENOENT'].includes(erro.code);

function hoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function adquirirTrava(arquivo) {
  const inicio = Date.now();
  const dono = { pid: process.pid, inicio, token: randomUUID() };
  for (;;) {
    try {
      const trava = tentarTrava(arquivo, dono);
      if (trava) return trava;
    } catch (erro) {
      if (!transitorio(erro)) throw erro;
    }
    if (Date.now() - inicio > 10000) throw new Error('Trava de custos indisponível.');
    Atomics.wait(pausa, 0, 0, 5);
  }
}

function lerDono(arquivo) {
  try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')); }
  catch (erro) { if (erro.code === 'ENOENT' || erro instanceof SyntaxError) return null; throw erro; }
}

function abandonada(arquivo) {
  const dono = lerDono(arquivo), stat = fs.statSync(arquivo);
  const inicio = typeof dono?.inicio === 'number' ? dono.inicio : Date.parse(dono?.inicio);
  if (Date.now() - (Number.isFinite(inicio) ? inicio : stat.mtimeMs) > 60000) return true;
  if (!Number.isInteger(dono?.pid) || dono.pid <= 0) return false;
  try { process.kill(dono.pid, 0); return false; }
  catch (erro) { return erro.code === 'ESRCH'; }
}

function tentarTrava(arquivo, dono) {
  const trava = `${arquivo}.lock`, guarda = `${arquivo}.guarda`;
  let fd;
  try { fd = fs.openSync(guarda, 'wx'); }
  catch (erro) {
    // Só expira a guarda curta por idade; um pid que acabou de sair não pode remover a guarda nova.
    if (erro.code === 'EEXIST' && Date.now() - fs.statSync(guarda).mtimeMs > 60000) fs.unlinkSync(guarda);
    throw erro;
  }
  let retida = false;
  try {
    fs.writeFileSync(fd, JSON.stringify(dono));
    if (fs.existsSync(trava)) {
      if (!abandonada(trava)) return null;
      fs.unlinkSync(trava);
    }
    fs.writeFileSync(trava, JSON.stringify(dono), { flag: 'wx' });
    retida = true;
    return { trava, guarda, token: dono.token };
  } finally { fs.closeSync(fd); if (!retida) fs.unlinkSync(guarda); }
}

function soltarTrava({ trava, guarda, token }) {
  try { if (lerDono(trava)?.token === token) fs.unlinkSync(trava); }
  finally { if (lerDono(guarda)?.token === token) fs.unlinkSync(guarda); }
}

function custo(evento) {
  const chaves = ['custoUsd', 'custo_usd', 'total_cost_usd', 'custoEstimadoUsd'];
  if (!chaves.some(chave => Object.hasOwn(evento, chave))) throw new Error('Evento sem campo de custo.');
  const valor = evento.custoUsd ?? evento.custo_usd ?? evento.total_cost_usd ?? evento.custoEstimadoUsd;
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0) throw new Error('Custo inválido no registro.');
  return valor;
}

function lerEventosArquivo(arquivo) {
  let texto;
  try { texto = fs.readFileSync(arquivo, 'utf8'); }
  catch (erro) { if (erro.code === 'ENOENT') return []; throw erro; }
  const linhas = texto.split('\n');
  const eventos = [];
  for (let i = 0; i < linhas.length; i++) {
    if (!linhas[i].trim()) continue;
    let evento;
    try { evento = JSON.parse(linhas[i]); }
    catch { if (i === linhas.length - 1 && !texto.endsWith('\n')) break; throw new Error(`Registro de custos corrompido na linha ${i + 1}.`); }
    if (!evento || typeof evento !== 'object' || Array.isArray(evento)) throw new Error('Evento de custo inválido.');
    custo(evento); eventos.push(evento);
  }
  return eventos;
}

const lerEventos = repo => lerEventosArquivo(arquivoCustos(repo));

function recuperarCauda(arquivo) {
  let fd;
  try { fd = fs.openSync(arquivo, 'r+'); } catch (erro) { if (erro.code === 'ENOENT') return ''; throw erro; }
  try {
    const tamanho = fs.fstatSync(fd).size;
    if (!tamanho) return '';
    const ultimo = Buffer.alloc(1); fs.readSync(fd, ultimo, 0, 1, tamanho - 1);
    if (ultimo[0] === 10) return '';
    const texto = fs.readFileSync(arquivo, 'utf8');
    const inicio = texto.lastIndexOf('\n') + 1;
    try { JSON.parse(texto.slice(inicio)); return '\n'; }
    catch { fs.ftruncateSync(fd, Buffer.byteLength(texto.slice(0, inicio))); return ''; }
  } finally { fs.closeSync(fd); }
}

export function registrar(repo, evento) {
  if (!evento || typeof evento !== 'object' || Array.isArray(evento)) throw new Error('Evento de custo inválido.');
  custo(evento);
  const dia = evento.dia ?? hoje();
  const arquivoDiario = ledger(homeCustos(), dia);
  const linha = JSON.stringify({ instante: new Date().toISOString(), ...evento, dia, repo: path.resolve(repo) }) + '\n';
  // Primeiro o ledger canônico: se o espelho falhar, o teto diário continua conservando o gasto.
  acrescentarUnico(arquivoDiario, linha, evento.idEvento);
  acrescentarUnico(arquivoCustos(repo), linha, evento.idEvento);
}

// Replay idempotente: evento com idEvento que já está no arquivo não é gravado de novo (cada arquivo é conferido sozinho,
// para completar o espelho se a queda ocorreu entre as duas gravações).
function acrescentarUnico(arquivo, linha, idEvento) {
  if (idEvento && lerEventosArquivo(arquivo).some(e => e.idEvento === idEvento)) return;
  acrescentar(arquivo, linha);
}

function acrescentar(arquivo, linha) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const trava = adquirirTrava(arquivo);
  try {
    const separador = recuperarCauda(arquivo);
    // A trava inclui reparação e append para serializar escritores de processos diferentes.
    fs.appendFileSync(arquivo, separador + linha, { encoding: 'utf8', flush: true });
  } finally { soltarTrava(trava); }
}

function idFeature(evento) {
  const id = evento.featureId ?? evento.idFeature ?? evento.feature_id ?? evento.feature;
  return typeof id === 'object' && id ? id.id : id;
}

function tokens(usage) {
  if (usage.total_tokens != null) return usage.total_tokens;
  return (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
}

function usos(evento) {
  const respostas = (evento.eventos ?? []).filter(e => e.type === 'assistant' && e.message?.usage);
  if (respostas.length) {
    const unicos = new Map(respostas.map((e, i) => [e.message.id ?? i, e.message.usage]));
    return [...unicos.values()];
  }
  return evento.usage ? [evento.usage] : (evento.eventos ?? []).filter(e => e.type === 'turn.completed' && e.usage).map(e => e.usage);
}

function somar(grupo, chave, valor) {
  if (chave == null) return;
  Object.defineProperty(grupo, chave, { value: (Object.hasOwn(grupo, chave) ? grupo[chave] : 0) + valor,
    enumerable: true, configurable: true, writable: true });
}

export function resumo(repo) {
  const saida = { custoTotalUsd: 0, porFeature: {}, porModelo: {}, porEtapa: {}, featuresAprovadas: 0,
    custoPorFeatureAprovada: null, tokensPorResposta: null };
  const aprovadas = new Set();
  let totalTokens = 0, respostas = 0;
  for (const evento of lerEventos(repo)) {
    const valor = custo(evento), id = idFeature(evento);
    saida.custoTotalUsd += valor;
    somar(saida.porFeature, id, valor); somar(saida.porModelo, evento.modelo, valor); somar(saida.porEtapa, evento.etapa, valor);
    if (id && (evento.aprovado === true || evento.passes === true || evento.estado === 'aprovada' || evento.veredito === 'APROVADO')) aprovadas.add(id);
    for (const uso of usos(evento)) { totalTokens += tokens(uso); respostas++; }
  }
  saida.featuresAprovadas = aprovadas.size;
  saida.custoPorFeatureAprovada = aprovadas.size ? saida.custoTotalUsd / aprovadas.size : null;
  saida.tokensPorResposta = respostas ? totalTokens / respostas : null;
  return saida;
}

export function custoFeature(repo, id) {
  return lerEventos(repo).filter(evento => idFeature(evento) === id).reduce((total, evento) => total + custo(evento), 0);
}

function ledger(home, dia) {
  if (typeof dia !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw new Error('Dia inválido no ledger de custos.');
  return path.join(home, `custos-${dia}.jsonl`);
}

export function custoDia(home, dia) {
  return lerEventosArquivo(ledger(home, dia)).reduce((total, evento) => total + custo(evento), 0);
}

function teto(valor, padrao) {
  const numero = Number(valor ?? padrao);
  if (!Number.isFinite(numero) || numero < 0) throw new Error('Teto de custo inválido.');
  return numero;
}

export function dentroDoTeto({ repo, feature, tetoFeatureUsd, tetoDiaUsd }) {
  try {
    const id = typeof feature === 'string' ? feature : feature?.id;
    if (typeof id !== 'string' || !id) throw new Error('Feature sem identificador para conferir o teto.');
    const limiteFeature = teto(tetoFeatureUsd ?? process.env.MARATONA_TETO_FEATURE_USD, 1);
    const limiteDia = teto(tetoDiaUsd ?? process.env.MARATONA_TETO_DIA_USD, 5);
    const gastoDia = custoDia(homeCustos(), hoje());
    const gastoFeature = custoFeature(repo, id);
    const restanteUsd = Math.max(0, Math.min(limiteFeature - gastoFeature, limiteDia - gastoDia));
    const motivo = gastoFeature >= limiteFeature ? 'Teto por feature atingido.' : gastoDia >= limiteDia ? 'Teto diário atingido.' : null;
    return { ok: !motivo, restanteUsd, motivo };
  } catch (erro) { return { ok: false, restanteUsd: 0, motivo: `Custos indisponíveis: ${erro.message}` }; }
}
