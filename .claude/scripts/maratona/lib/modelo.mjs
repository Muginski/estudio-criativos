import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { randomUUID } from 'node:crypto';
import { mascararSegredos } from './tradutor.mjs';

// Preços de referência por milhão do baseline-gasto.mjs; não são faturamento.
const PRECOS = [
  [/^(claude-)?opus/i, 4, 12], [/^(claude-)?sonnet/i, 3, 15],
  [/^(claude-)?haiku/i, 0.10, 0.50], [/fable/i, 3, 15],
  [/gpt.*astra/i, 5, 15], [/gpt|sol|o\d/i, 3, 15],
];
const tokens = n => Number.isFinite(n) && n > 0 ? n : 0;
const diagnostico = texto => texto ? mascararSegredos(texto).slice(0, 2000) : null;

export function estimarCustoUsd(modelo, usage = {}) {
  const [, entrada, saida] = PRECOS.find(([re]) => re.test(modelo || '')) || [null, 3, 15];
  const leitura = tokens(usage?.cache_read_input_tokens ?? usage?.cached_input_tokens);
  const escrita = tokens(usage?.cache_creation_input_tokens ?? usage?.cache_write_input_tokens);
  const cacheIncluso = usage?.cached_input_tokens !== undefined || usage?.cache_write_input_tokens !== undefined;
  const novos = Math.max(0, tokens(usage?.input_tokens) - (cacheIncluso ? leitura + escrita : 0));
  const resposta = tokens(usage?.output_tokens) + tokens(usage?.reasoning_output_tokens);
  return (novos * entrada + resposta * saida + escrita * entrada * 1.25 + leitura * entrada * 0.10) / 1e6;
}

export function argsTurno({ sistema, modelo, ferramentas = [], esforco }) {
  const lista = ferramentas.join(',');
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--setting-sources', '',
    '--tools', lista, '--allowedTools', lista, '--permission-mode', 'acceptEdits',
    '--model', modelo, '--system-prompt', sistema,
    '--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: {} }),
    '--settings', JSON.stringify({ disableAllHooks: true })];
  if (esforco) args.push('--effort', esforco);
  return args;
}

function executavel(arquivo) {
  if (/\.(cmd|bat)$/i.test(arquivo)) return false;
  try {
    if (!fs.statSync(arquivo).isFile()) return false;
    fs.accessSync(arquivo, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return process.platform !== 'win32' || /\.exe$/i.test(arquivo);
  } catch { return false; }
}

export function findExe(nome) {
  if (path.isAbsolute(nome) || /[\\/]/.test(nome)) {
    if (executavel(nome)) return nome;
  } else {
    const nomes = process.platform === 'win32' && !/\.exe$/i.test(nome) ? [nome + '.exe'] : [nome];
    for (const pasta of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
      for (const n of nomes) {
        const candidato = path.join(pasta.replace(/^"|"$/g, ''), n);
        if (executavel(candidato)) return candidato;
      }
    }
  }
  throw new Error(`Executável não encontrado: ${nome}. Instale a versão nativa; .cmd/.bat exigem shell e não são aceitos.`);
}

export function matarArvore(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) throw new Error('PID de turno inválido; encerramento recusado.');
  if (process.platform !== 'win32') {
    try { process.kill(-pid, 'SIGKILL'); }
    catch { try { process.kill(pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; } }
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'],
      { windowsHide: true, timeout: 20000 }, erro => {
        if (erro) { try { process.kill(pid, 'SIGKILL'); } catch (e) { if (e.code === 'ESRCH') return resolve(null); } }
        resolve(erro ? 'Não foi possível confirmar o encerramento de toda a árvore.' : null);
      });
  });
}

// PID persistido pode ter sido reaproveitado; só o processo identificado no spawn pode ser encerrado.
export async function conferirTurno(j) {
  if (!Number.isSafeInteger(j.pid_turno) || j.pid_turno <= 0 || j.pid_turno === process.pid) return 'PID de turno inválido';
  if (!Number.isFinite(j.inicio_turno) || j.inicio_turno <= 0 || !Number.isFinite(Date.parse(j.inicio)) ||
      typeof j.executavel_turno !== 'string' || typeof j.marcador_turno !== 'string' || !j.marcador_turno) return 'identidade do spawn ausente ou inválida no journal';
  const exe = j.executavel_turno.toLowerCase();
  if (!['claude.exe', 'codex.exe', 'node.exe'].includes(exe)) return 'executável do turno não permitido';
  if (exe === 'node.exe' && (typeof j.script_turno !== 'string' || !j.script_turno)) return 'script node não registrado no spawn';
  if (process.platform !== 'win32') return 'consulta segura de processo indisponível nesta plataforma';
  let p;
  try {
    const comando = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${j.pid_turno}' -ErrorAction Stop; ` +
      `if ($null -eq $p) { 'null' } else { @{ nome=$p.Name; linha=$p.CommandLine; criada=$p.CreationDate.ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress }`;
    p = await new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', comando],
      { windowsHide: true, timeout: 10000, encoding: 'utf8' }, (erro, stdout) => {
        if (erro) return reject(erro);
        try { resolve(JSON.parse(stdout.replace(/^\uFEFF/, ''))); } catch (e) { reject(e); }
      }));
  } catch { return 'não foi possível consultar Name, CommandLine e CreationDate do processo'; }
  if (!p) return 'processo não encontrado';
  if (typeof p.nome !== 'string' || p.nome.toLowerCase() !== exe) return 'executável do processo difere do spawn';
  if (typeof p.linha !== 'string' || !p.linha.includes(j.marcador_turno)) return 'marcador do turno ausente na linha de comando';
  if (exe === 'node.exe') {
    const script = j.script_turno.replaceAll('\\', '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`(?:^|[\\s"])${script}(?=[\\s"]|$)`).test(p.linha.replaceAll('\\', '/'))) return 'script node difere do registrado no spawn';
  }
  const criada = Date.parse(p.criada);
  if (!Number.isFinite(criada) || criada < Math.max(j.inicio_turno, Date.parse(j.inicio))) return 'data de criação (CreationDate) anterior ao início do turno ou indisponível';
  return null;
}

function somarUsage(destino, usage) {
  for (const [chave, valor] of Object.entries(usage || {})) {
    if (typeof valor === 'number' && Number.isFinite(valor)) destino[chave] = (destino[chave] || 0) + valor;
  }
}

function atualizarUso(estado, mensagem) {
  const id = mensagem.id || `evento-${estado.usos.size}`;
  const anterior = estado.usos.get(id);
  const usage = { ...anterior?.usage };
  for (const [chave, valor] of Object.entries(mensagem.usage)) {
    if (Number.isFinite(valor) && valor >= 0) usage[chave] = Math.max(usage[chave] || 0, valor);
  }
  estado.usos.set(id, { usage, modelo: mensagem.model || anterior?.modelo || estado.modelo });
}

function custoExato(estado) {
  const custo = estado.result?.total_cost_usd;
  return Number.isFinite(custo) && custo >= 0 ? custo : null;
}

function custoEstimado(estado) {
  if (!estado.usos.size) return estimarCustoUsd(estado.modelo, estado.result?.usage);
  let total = 0;
  for (const { modelo, usage } of estado.usos.values()) total += estimarCustoUsd(modelo, usage);
  return total;
}

function receberEvento(estado, evento, onEvento, cortar, tetoUsd) {
  if (evento.type === 'assistant' && evento.message?.usage) {
    atualizarUso(estado, evento.message);
  }
  if (evento.type === 'result') estado.result = evento;
  const custo = custoExato(estado) ?? custoEstimado(estado);
  if ((tetoUsd !== null && custo > tetoUsd) || evento.subtype === 'error_max_budget_usd') cortar('teto');
  try { onEvento?.(evento); }
  catch (e) { estado.erro = `Falha ao tratar evento do modelo: ${e.message}`; cortar(null); }
}

function lerStream(processo, estado, onEvento, cortar, tetoUsd) {
  const decoder = new StringDecoder('utf8');
  let pendente = '';
  const consumir = texto => {
    pendente += texto;
    let fim;
    while ((fim = pendente.indexOf('\n')) >= 0) {
      const linha = pendente.slice(0, fim); pendente = pendente.slice(fim + 1);
      let evento;
      try { evento = JSON.parse(linha); } catch { continue; }
      if (evento && typeof evento === 'object') receberEvento(estado, evento, onEvento, cortar, tetoUsd);
    }
  };
  processo.stdout.on('data', chunk => consumir(decoder.write(chunk)));
  processo.stdout.on('end', () => consumir(decoder.end() + '\n'));
  processo.stderr.setEncoding('utf8');
  processo.stderr.on('data', texto => { estado.stderr += texto; });
}

function resposta(estado, code, inicio) {
  const result = estado.result;
  let erro = estado.erro;
  if (estado.cortadoPor) erro ||= `Turno interrompido por ${estado.cortadoPor === 'tempo' ? 'limite de tempo' : 'teto de custo'}.`;
  else if (code !== 0) erro ||= `Modelo encerrou com código ${code}: ${estado.stderr || result?.result || 'sem diagnóstico'}`;
  else if (!result) erro ||= 'Stream do modelo terminou sem evento result.';
  else if (result.is_error || (result.subtype && result.subtype !== 'success')) erro ||= `Modelo informou erro: ${result.result || result.subtype}`;
  const usage = {};
  for (const u of estado.usos.values()) somarUsage(usage, u.usage);
  return { code, resultado: result?.result ?? null, erro: diagnostico(erro),
    custoUsd: custoExato(estado), custoEstimadoUsd: custoEstimado(estado), usage: result?.usage ?? usage,
    duracaoMs: Date.now() - inicio, cortadoPor: estado.cortadoPor };
}

function executar({ exe, args, prompt, modelo, cwd, limiteMin, tetoUsd, onEvento, onProcesso, identidade }, inicio) {
  return new Promise(resolve => {
    const estado = { stderr: '', erro: null, cortadoPor: null, result: null,
      modelo, usos: new Map() };
    let processo, matando = null;
    identidade.inicio_turno = Date.now();
    try { processo = spawn(exe, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true, detached: process.platform !== 'win32', shell: false }); }
    catch (e) { estado.erro = `Não foi possível iniciar o modelo: ${e.message}`; return resolve(resposta(estado, -1, inicio)); }
    const cortar = motivo => {
      if (matando) return;
      estado.cortadoPor = motivo;
      matando = matarArvore(processo.pid);
    };
    const timer = setTimeout(() => cortar('tempo'), Math.max(0, limiteMin * 60000));
    lerStream(processo, estado, onEvento, cortar, tetoUsd);
    processo.once('spawn', () => {
      try { onProcesso?.(processo.pid, identidade); }
      catch (e) { estado.erro = `Falha ao registrar PID do modelo: ${e.message}`; cortar(null); }
    });
    processo.on('error', e => { estado.erro = `Não foi possível iniciar o modelo: ${e.message}`; });
    processo.on('close', async code => {
      clearTimeout(timer);
      const falhaMorte = await matando;
      if (falhaMorte) estado.erro = `${estado.erro || 'Turno interrompido.'} ${falhaMorte}`;
      try { onProcesso?.(null); } catch (e) { estado.erro = `Falha ao limpar PID do modelo: ${e.message}`; }
      resolve(resposta(estado, code ?? -1, inicio));
    });
    processo.stdin.on('error', e => {
      if (e.code !== 'EPIPE' && !estado.cortadoPor) estado.erro = `Falha enviando prompt: ${e.message}`;
    });
    processo.stdin.end(prompt);
  });
}

export async function chamarClaude({ prompt, sistema, modelo, cwd, ferramentas = [],
  limiteMin = 30, tetoUsd = null, esforco = null, onEvento, onProcesso }) {
  const inicio = Date.now();
  // Sem saldo não há chamada: teto finito <= 0 nem sequer vira --max-budget-usd, então o processo não pode iniciar.
  if (Number.isFinite(tetoUsd) && tetoUsd <= 0) {
    return { code: -1, resultado: null, erro: 'Teto de custo esgotado; chamada não iniciada.', custoUsd: 0, custoEstimadoUsd: 0, usage: {}, duracaoMs: 0, cortadoPor: 'teto' };
  }
  try {
    const exe = findExe(process.env.MARATONA_CLAUDE_EXE || 'claude');
    const identidade = { executavel_turno: path.basename(exe), marcador_turno: `maratona-${randomUUID()}`,
      script_turno: process.env.MARATONA_CLAUDE_SCRIPT || null };
    const args = argsTurno({ sistema: `${sistema}\nIdentificador do turno: ${identidade.marcador_turno}`, modelo, ferramentas, esforco });
    // O orçamento nativo protege também o intervalo antes do primeiro custo no stream.
    if (Number.isFinite(tetoUsd) && tetoUsd > 0) args.push('--max-budget-usd', String(tetoUsd));
    if (process.env.MARATONA_CLAUDE_SCRIPT) args.unshift(process.env.MARATONA_CLAUDE_SCRIPT);
    return await executar({ exe, args, prompt, modelo, cwd, limiteMin, tetoUsd, onEvento, onProcesso, identidade }, inicio);
  } catch (e) {
    return { code: -1, resultado: null, erro: diagnostico(`Falha ao chamar modelo: ${e.message}`),
      custoUsd: null, custoEstimadoUsd: 0, usage: {}, duracaoMs: Date.now() - inicio, cortadoPor: null };
  }
}
