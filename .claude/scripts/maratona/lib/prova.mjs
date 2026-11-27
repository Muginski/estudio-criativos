import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mascararSegredos } from './tradutor.mjs';

const execArquivo = promisify(execFile);
const MAX_CAUDA = 64 * 1024;

export function normalizarComandos(verificacao) {
  if (verificacao == null) return [];
  const lista = Array.isArray(verificacao) ? verificacao : [verificacao];
  return lista.map(item => {
    const cmd = typeof item === 'string' ? item : item?.cmd;
    const timeoutMin = typeof item === 'object' ? item?.timeoutMin ?? 10 : 10;
    if (typeof cmd !== 'string' || !cmd.trim()) throw new Error('Comando de verificação inválido.');
    if (!Number.isFinite(timeoutMin) || timeoutMin <= 0) throw new Error('Timeout de verificação inválido.');
    return { cmd: cmd.trim(), timeoutMin };
  });
}

function caminhoNormal(caminho) {
  return String(caminho).replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase();
}

export function ehArquivoDeTeste(caminho) {
  const nome = caminhoNormal(caminho);
  if (/(^|\/)(test|tests|__tests__|__mocks__|__snapshots__|fixtures?|cypress|e2e)(\/|$)|^spec\//.test(nome)) return true;
  const codigo = /\.(?:[cm]?[jt]sx?|py|rb|go|rs|cs|java|kt|php|swift|c|cpp)$/.test(nome);
  if (/(^|\/)spec\//.test(nome) && codigo) return true;
  if (/(^|\/)test-utils\.[cm]?[jt]sx?$/.test(nome)) return false;
  return /[-_.](test|spec)\.[^/]+$|(^|\/)test[-_.][^/]+$|\.snap$/.test(nome);
}

export function ehArquivoSegredo(caminho) {
  const nome = caminhoNormal(caminho).split('/').at(-1);
  if (/^\.env\.(example|sample|template)$/.test(nome)) return false;
  return /^\.env($|\.)|\.(pem|key|pfx|p12|keystore|jks)$|^\.(npmrc|netrc|pgpass)$|^credentials|^id_(rsa|ed25519|ecdsa|dsa)($|\.)|^secrets?\.|^serviceaccount/.test(nome);
}

function matarArvore(processo) {
  if (!processo.pid) return;
  if (process.platform === 'win32') {
    const exe = path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'taskkill.exe');
    const matador = spawn(exe, ['/PID', String(processo.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 2000 });
    matador.on('error', () => processo.kill('SIGKILL'));
    matador.on('close', code => { if (code !== 0) processo.kill('SIGKILL'); });
  } else {
    try { process.kill(-processo.pid, 'SIGKILL'); } catch { processo.kill('SIGKILL'); }
  }
}

function executarComando({ cmd, cwd, timeoutMin }) {
  return new Promise(resolve => {
    const hash = createHash('sha256');
    let cauda = Buffer.alloc(0), cortado = false, erro = null, finalizado = false, encerramento;
    const processo = spawn(cmd, { cwd, shell: true, detached: process.platform !== 'win32', windowsHide: true });
    const receber = dado => {
      hash.update(dado);
      cauda = Buffer.concat([cauda, dado.subarray(-MAX_CAUDA)]).subarray(-MAX_CAUDA);
    };
    const concluir = code => {
      if (finalizado) return;
      finalizado = true;
      clearTimeout(timer); clearTimeout(encerramento);
      processo.stdout.destroy(); processo.stderr.destroy(); processo.unref();
      resolve({ code: cortado || erro ? -1 : code, cauda: cauda.toString('utf8'), sha256: hash.digest('hex'),
        erro: erro || (cortado ? 'Tempo de verificação esgotado.' : null), cortadoPor: cortado ? 'tempo' : null });
    };
    const timer = setTimeout(() => {
      cortado = true; matarArvore(processo);
      // Permissão negada pelo SO também deve devolver reprovação, sem prender o runner.
      encerramento = setTimeout(() => concluir(-1), 3000);
    }, timeoutMin * 60000);
    processo.stdout.on('data', receber);
    processo.stderr.on('data', receber);
    processo.on('error', e => { erro = e.message; });
    processo.on('close', concluir);
  });
}

function resultadoItem(cmd, inicio, resultado) {
  const saida = String(resultado?.stdout ?? '') + String(resultado?.stderr ?? '');
  const code = resultado?.erro || resultado?.cortadoPor || resultado?.signal ? -1 : resultado?.code;
  return { cmd, code: Number.isInteger(code) ? code : -1, ms: Date.now() - inicio,
    cauda: mascararSegredos(Buffer.from(String(resultado?.cauda ?? saida)).subarray(-MAX_CAUDA).toString('utf8')),
    sha256: resultado?.sha256 || createHash('sha256').update(saida).digest('hex') };
}

export async function rodarVerificacao({ repo, comandos, timeoutMin = 10, executar = executarComando }) {
  const itens = [];
  let lista;
  try {
    const entrada = Array.isArray(comandos) ? comandos : comandos == null ? [] : [comandos];
    lista = normalizarComandos(entrada.map(c => typeof c === 'string' ? { cmd: c, timeoutMin } : { timeoutMin, ...c }));
  } catch (erro) { return { ok: false, itens: [resultadoItem('', Date.now(), { erro: erro.message, stderr: erro.message })] }; }
  for (const comando of lista) {
    const inicio = Date.now();
    try { itens.push(resultadoItem(comando.cmd, inicio, await executar({ ...comando, cwd: repo }))); }
    catch (erro) { itens.push(resultadoItem(comando.cmd, inicio, { erro: erro.message, stderr: erro.message })); }
  }
  return { ok: itens.length > 0 && itens.every(item => item.code === 0), itens };
}

async function executarGit(args, { cwd, encoding = 'utf8' }) {
  return (await execArquivo('git', args, { cwd, encoding, maxBuffer: 32 * 1024 * 1024, windowsHide: true })).stdout;
}

async function lerBlob(git, repo, objeto) {
  const resultado = await git(['cat-file', 'blob', objeto], { cwd: repo, encoding: 'buffer' });
  if (Buffer.isBuffer(resultado)) return resultado;
  if (typeof resultado === 'string') return Buffer.from(resultado, 'utf8');
  if (!resultado || (resultado.code ?? resultado.status ?? 0) !== 0 || resultado.erro) throw new Error('Git falhou.');
  if (Buffer.isBuffer(resultado.stdout)) return resultado.stdout;
  if (typeof resultado.stdout === 'string') return Buffer.from(resultado.stdout, 'utf8');
  throw new Error('Saída do Git indisponível.');
}

// Conteúdo comparado byte a byte (latin1 é sem perda), trocando apenas CRLF por LF.
function semCrlf(conteudo) {
  return conteudo.toString('latin1').replace(/\r\n/g, '\n');
}

// Remove só modificações (M, mesmo caminho) cujo conteúdo, em todas as versões
// observadas, é igual ao da base após normalizar CRLF→LF. Remoção, rename e
// alteração real continuam valendo; qualquer falha de leitura mantém a alteração.
async function filtrarSoEol(alteracoes, base, blob, versoes) {
  const restantes = [];
  for (const alteracao of alteracoes) {
    let equivalente = false;
    if (alteracao.status === 'M' && alteracao.origem === alteracao.destino) {
      try {
        const referencia = semCrlf(await blob(`${base}:${alteracao.origem}`));
        const outras = await versoes(alteracao.origem);
        equivalente = outras.length > 0 && outras.every(outra => semCrlf(outra) === referencia);
      } catch { equivalente = false; }
    }
    if (!equivalente) restantes.push(alteracao);
  }
  return restantes;
}

async function lerGit(git, repo, args) {
  const resultado = await git(args, { cwd: repo });
  if (typeof resultado === 'string' || Buffer.isBuffer(resultado)) return String(resultado);
  if (!resultado || (resultado.code ?? resultado.status ?? 0) !== 0 || resultado.erro) throw new Error('Git falhou.');
  if (typeof resultado.stdout !== 'string') throw new Error('Saída do Git indisponível.');
  return resultado.stdout;
}

function lerAlteracoes(texto) {
  const campos = texto.split('\0');
  const alteracoes = [];
  for (let i = 0; i < campos.length; i++) {
    const status = campos[i].trim();
    if (!status) continue;
    if (!/^[ACDMRTUXB]\d*$/.test(status) || campos[i + 1] == null) throw new Error('Diff do Git inválido.');
    const origem = campos[++i];
    const destino = /^[RC]/.test(status) ? campos[++i] : origem;
    if (!origem || !destino) throw new Error('Caminho ausente no diff.');
    alteracoes.push({ status, origem, destino });
  }
  return alteracoes;
}

function problemasAlteracoes(alteracoes, existentes, permiteTestes) {
  const problemas = [];
  for (const { status, origem, destino } of alteracoes) {
    for (const arquivo of new Set([origem, destino])) {
      if (/(^|\/)\.maratona(\/|$)/.test(caminhoNormal(arquivo))) problemas.push(`Estado .maratona alterado: ${arquivo}`);
      if (ehArquivoSegredo(arquivo)) problemas.push(`Arquivo de segredo alterado: ${arquivo}`);
      if (!permiteTestes && configProtegida(arquivo) && ((/^[MDR]/.test(status) && existentes.has(arquivo)) || !/(^|\/)\.github\//.test(caminhoNormal(arquivo)))) {
        problemas.push(`Configuração de prova protegida: ${arquivo}`);
      }
    }
    if (!permiteTestes && status[0] !== 'A' && status[0] !== 'C' && existentes.has(origem) && ehArquivoDeTeste(origem)) {
      problemas.push(`Teste existente alterado, apagado ou renomeado: ${origem}`);
    }
  }
  return problemas;
}

function configProtegida(arquivo) {
  const nome = caminhoNormal(arquivo);
  return /(^|\/)\.github\//.test(nome) || /(^|\/)(conftest\.py|makefile)$/.test(nome) ||
    /(^|\/)(jest|vitest|playwright|cypress|karma|mocha|ava|tap|test|testing|pytest|nyc)\.config\.[^/]+$/.test(nome);
}

function scriptsPackage(texto) {
  if (texto == null) return {};
  const scripts = JSON.parse(texto).scripts ?? {};
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) throw new Error('Scripts de package.json inválidos.');
  return scripts;
}

function scriptsMudaram(base, atual) {
  return Object.keys(base).some(chave => !Object.hasOwn(atual, chave) || atual[chave] !== base[chave]);
}

async function scriptsGit(ler, ref, arquivo, presentes) {
  return scriptsPackage(presentes.has(arquivo) ? await ler(['show', `${ref}:${arquivo}`]) : null);
}

async function checarScripts({ repo, base, ler, alteracoes, existentes }) {
  const arquivos = [...new Set(alteracoes.flatMap(a => [a.origem, a.destino]))]
    .filter(a => caminhoNormal(a).split('/').at(-1) === 'package.json');
  if (!arquivos.length) return [];
  const indice = new Set((await ler(['ls-files', '--cached', '-z'])).split('\0').filter(Boolean));
  const commits = (await ler(['log', '--format=%H', `${base}..HEAD`, '--', ...arquivos])).trim().split(/\r?\n/).filter(Boolean);
  const problemas = [];
  for (const arquivo of arquivos) {
    if (!existentes.has(arquivo)) continue;
    const referencia = await scriptsGit(ler, base, arquivo, existentes);
    const absoluto = path.join(repo, arquivo);
    const disco = scriptsPackage(fs.existsSync(absoluto) ? fs.readFileSync(absoluto, 'utf8') : null);
    let mudou = scriptsMudaram(referencia, disco) || scriptsMudaram(referencia, await scriptsGit(ler, '', arquivo, indice));
    for (const commit of commits) {
      const presentes = new Set((await ler(['ls-tree', '-r', '--name-only', '-z', commit, '--', arquivo])).split('\0').filter(Boolean));
      if (scriptsMudaram(referencia, await scriptsGit(ler, commit, arquivo, presentes))) mudou = true;
    }
    if (mudou) problemas.push(`Scripts de verificação alterados: ${arquivo}`);
  }
  return problemas;
}

export async function checarIntegridade({ repo, base, permiteTestes = false, git = executarGit }) {
  try {
    if (typeof base !== 'string' || !base || base.startsWith('-')) throw new Error('Base Git inválida.');
    const ler = args => lerGit(git, repo, args);
    const existentes = new Set((await ler(['ls-tree', '-r', '--name-only', '-z', base])).split('\0').filter(Boolean));
    const atuais = lerAlteracoes(await ler(['diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '-M', base, '--']));
    const indice = lerAlteracoes(await ler(['diff', '--cached', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '-M', base, '--']));
    const historico = lerAlteracoes(await ler(['log', '--format=', '--name-status', '-z', '-M', `${base}..HEAD`, '--']));
    const novos = (await ler(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean)
      .map(arquivo => ({ status: 'A', origem: arquivo, destino: arquivo }));
    const blob = objeto => lerBlob(git, repo, objeto);
    const atuaisReais = await filtrarSoEol(atuais, base, blob, async arquivo => [fs.readFileSync(path.join(repo, arquivo))]);
    const indiceReal = await filtrarSoEol(indice, base, blob, async arquivo => [await blob(`:${arquivo}`)]);
    const historicoReal = await filtrarSoEol(historico, base, blob, async arquivo => {
      const commits = (await ler(['log', '--format=%H', `${base}..HEAD`, '--', arquivo])).trim().split(/\r?\n/).filter(Boolean);
      const versoes = [];
      for (const commit of commits) versoes.push(await blob(`${commit}:${arquivo}`));
      return versoes;
    });
    const alteracoes = [...atuaisReais, ...indiceReal, ...historicoReal, ...novos];
    const problemas = problemasAlteracoes(alteracoes, existentes, permiteTestes);
    if (!permiteTestes) problemas.push(...await checarScripts({ repo, base, ler, alteracoes, existentes }));
    if (!atuais.length && !novos.length) problemas.push('Nada mudou desde a base.');
    return { ok: problemas.length === 0, problemas: [...new Set(problemas)] };
  } catch (erro) { return { ok: false, problemas: [`Integridade indisponível: ${erro.message}`] }; }
}

export function registrarFolha(repo, entrada) {
  const arquivo = path.join(repo, '.maratona', 'folha-de-provas.md');
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const texto = typeof entrada === 'string' ? entrada : JSON.stringify(entrada);
  fs.appendFileSync(arquivo, `\n## ${new Date().toISOString()}\n\n${mascararSegredos(texto)}\n`, 'utf8');
}
