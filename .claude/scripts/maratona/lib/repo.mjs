// Operações de git da maratona. Regra: só mexe em branch maratona/*, nunca faz push.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ehArquivoSegredo } from './prova.mjs';

const MAX_BUFFER = 64 * 1024 * 1024;
const PARADA = new Set(['para', 'com', 'sem', 'uma', 'das', 'dos', 'que', 'por', 'nas', 'nos', 'como', 'mais',
  'feature', 'criar', 'adicionar', 'implementar', 'ajustar', 'fazer', 'novo', 'nova']);

export function git(repo, args, { permitirFalha = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: MAX_BUFFER, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  } catch (e) {
    if (permitirFalha) return null;
    throw new Error(`git ${args[0]} falhou: ${String(e.stderr || e.message).trim().slice(0, 300)}`);
  }
}

export const noEstado = caminho => /^\.maratona(\/|$)/.test(String(caminho).replaceAll('\\', '/'));
export const ramoAtual = repo => git(repo, ['symbolic-ref', '--short', '-q', 'HEAD'], { permitirFalha: true })?.trim() || null;
export const head = repo => git(repo, ['rev-parse', 'HEAD']).trim();
export const naoSegredo = caminhos => caminhos.filter(c => !ehArquivoSegredo(c));

export function ehRepoGit(repo) {
  return git(repo, ['rev-parse', '--verify', '-q', 'HEAD'], { permitirFalha: true }) !== null;
}

// Caminhos sujos fora de .maratona (renomeações trazem a origem num campo extra do -z).
export function sujeira(repo) {
  const campos = git(repo, ['status', '--porcelain', '-z', '--untracked-files=all']).split('\0').filter(Boolean);
  const sujos = [];
  for (let i = 0; i < campos.length; i++) {
    const caminhos = [campos[i].slice(3)];
    if (/[RC]/.test(campos[i].slice(0, 2))) caminhos.push(campos[++i]);
    sujos.push(...caminhos.filter(c => !noEstado(c)));
  }
  return sujos;
}

export function prepararRamo(repo, nome) {
  const alvo = `maratona/${nome}`;
  const atual = ramoAtual(repo);
  if (atual === alvo) return alvo;
  if (!atual) throw new Error('HEAD solto (detached): entre numa branch antes de rodar.');
  const existe = git(repo, ['rev-parse', '--verify', '-q', `refs/heads/${alvo}`], { permitirFalha: true });
  git(repo, existe ? ['checkout', '-q', alvo] : ['checkout', '-q', '-b', alvo]);
  return alvo;
}

// -f: um .gitignore do projeto não pode esconder o estado da maratona. Commit só de estado: sem hooks e com pathspec,
// para que nada além de .maratona entre nele (hook só roda no commit do código, onde a árvore é conferida).
export function commitarEstado(repo, mensagem) {
  git(repo, ['add', '-A', '-f', '--', '.maratona']);
  if (!git(repo, ['diff', '--cached', '--name-only', '--', '.maratona']).trim()) return false;
  git(repo, ['commit', '--no-verify', '-q', '-m', mensagem, '--', '.maratona']);
  return true;
}

// Stage de tudo e confere segredo antes de qualquer commit; segredo desfaz o stage inteiro.
export function prepararCommit(repo) {
  git(repo, ['add', '-A']);
  const staged = git(repo, ['diff', '--cached', '--name-only', '-z']).split('\0').filter(Boolean);
  const segredos = staged.filter(ehArquivoSegredo);
  if (segredos.length) { git(repo, ['reset', '-q']); return { ok: false, segredos }; }
  return { ok: staged.length > 0, segredos: [], vazio: staged.length === 0 };
}

// Commit só do código já preparado no índice; o estado da maratona entra em commit próprio depois da prova (commitarEstado).
export function commitarCodigo(repo, mensagem) {
  git(repo, ['commit', '-q', '-m', mensagem]);
  return head(repo);
}

export const arvoreDoIndice = repo => git(repo, ['write-tree']).trim();
export const arvoreDoHead = repo => git(repo, ['rev-parse', 'HEAD^{tree}']).trim();

// Código (tudo fora de .maratona) igual entre dois commits? Erro do git conta como diferente.
export function codigoIgual(repo, a, b) {
  return git(repo, ['diff', '--quiet', a, b, '--', '.', ':(exclude).maratona'], { permitirFalha: true }) !== null;
}
export const codigoMudou = (repo, commit) => !codigoIgual(repo, commit, 'HEAD');

// Guardas comuns antes de qualquer etapa paga ou gravação de estado: repo com commit, árvore limpa, HEAD em branch.
export function guardaDoRepo(repo) {
  if (!ehRepoGit(repo)) return 'Repositório git sem commit inicial.';
  const sujos = sujeira(repo);
  if (sujos.length) return `Árvore suja (${sujos.length} caminho(s) fora de .maratona: ${sujos.slice(0, 5).join(', ')}); nada foi tocado.`;
  return ramoAtual(repo) ? null : 'HEAD solto (detached): entre numa branch antes de rodar.';
}

// Patch da tentativa inteira (inclui não rastreados); segredo nunca entra no arquivo.
export function salvarPatch(repo, base, destino) {
  git(repo, ['add', '-A']);
  for (const f of git(repo, ['diff', '--cached', '--name-only', '-z', base]).split('\0').filter(Boolean)) {
    // Volta o índice à base (não ao HEAD): um segredo que o agente já commitou também sai do diff.
    if (ehArquivoSegredo(f)) git(repo, ['reset', '-q', base, '--', f]);
  }
  const patch = git(repo, ['diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv', base]);
  git(repo, ['reset', '-q']);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, patch);
  return patch.length;
}

// Reset duro só na branch da maratona e só depois do patch salvo (chamador garante a ordem).
export function reverter(repo, base, ramo) {
  if (!ramo.startsWith('maratona/')) throw new Error(`Recusado: reset fora de maratona/* (${ramo}).`);
  if (ramoAtual(repo) !== ramo) git(repo, ['checkout', '-q', '-f', ramo]); // o agente trocou de branch
  git(repo, ['reset', '-q', '--hard', base]);
  git(repo, ['clean', '-fdq']);
}

// Desfaz um commit guardado sem reescrever o histórico (há commits de estado por cima dele).
export function desfazerCommit(repo, commit) {
  try { git(repo, ['revert', '--no-edit', commit]); }
  catch (e) { git(repo, ['revert', '--abort'], { permitirFalha: true }); throw e; }
}

// Sujeira deixada pela própria verificação da base (arquivos gerados, testes regravados): restaura rastreados e remove não
// rastreados, sem -x (ignorados ficam) e sem tocar em .maratona. Só chamar com a árvore já confirmada limpa antes da prova.
export function limparContaminacao(repo) {
  if (!sujeira(repo).length) return false;
  git(repo, ['checkout', '--', '.', ':(exclude).maratona']);
  git(repo, ['clean', '-fdq', '-e', '.maratona']);
  return true;
}

// Intenção de adicionar: faz arquivos novos aparecerem em `git diff <base>` sem criar commit.
export function marcarIntencao(repo) { git(repo, ['add', '-N', '.']); }
export function desmarcarIntencao(repo) { git(repo, ['reset', '-q']); }

export function tamanhoDiff(repo, base, teto = 240_000) {
  return Math.min(teto, git(repo, ['diff', '--no-ext-diff', '--no-textconv', base, '--']).length);
}

export function listarArquivos(repo, max = 300) {
  return git(repo, ['ls-files', '-z']).split('\0').filter(c => c && !noEstado(c)).slice(0, max).join('\n');
}

export function termosDoTitulo(titulo) {
  const palavras = String(titulo).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
  return [...new Set(palavras.filter(p => !PARADA.has(p)))].slice(0, 5);
}

// Só caminhos (nunca conteúdo), ordenados por quantidade de linhas que casam.
export function caminhosCandidatos(repo, titulo, max = 8) {
  const termos = termosDoTitulo(titulo);
  if (!termos.length) return [];
  const args = ['grep', '-I', '-i', '-c', '-F', ...termos.flatMap(t => ['-e', t]), '--', '.', ':(exclude).maratona', ':(exclude)*lock*'];
  const saida = git(repo, args, { permitirFalha: true });
  if (!saida) return [];
  const itens = saida.split('\n').filter(Boolean).map(l => ({ caminho: l.slice(0, l.lastIndexOf(':')), n: Number(l.slice(l.lastIndexOf(':') + 1)) }));
  return naoSegredo(itens.filter(i => i.n > 0).sort((a, b) => b.n - a.n || a.caminho.localeCompare(b.caminho)).map(i => i.caminho)).slice(0, max);
}
