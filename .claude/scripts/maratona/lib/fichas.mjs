// Prompt do turno, fichas (tradutor) e textos de commit/achado. Fichas e achados entram como dado delimitado, nunca como instrução.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { traduzir, mascararSegredos, estimarTokens } from './tradutor.mjs';
import { acompanharProcesso } from './execucao.mjs';
import { conferirParada } from './registro.mjs';
import { normalizarComandos } from './prova.mjs';
import { listarArquivos, caminhosCandidatos } from './repo.mjs';
import { lancarCusto, restanteAgora, custoDe } from './orcamento.mjs';

const FONTES_PROJETO = ['README.md', 'CLAUDE.md', 'AGENTS.md', 'package.json'];

export const tipoCommit = t => (/\b(fix|corrig\w*|bug|erro)\b/i.test(t) ? 'fix' : /\btest\w*\b/i.test(t) ? 'test'
  : /\brefator\w*\b/i.test(t) ? 'refactor' : /\b(docs?|readme)\b/i.test(t) ? 'docs' : 'feat');
export const mensagemCommit = f => `${tipoCommit(f.titulo)}(${f.id}): ${f.titulo}`;
export const resumoFeature = f => ({ id: f.id, titulo: f.titulo, descricao: f.descricao, verificacao: f.verificacao });
export const formatarAchado = a => mascararSegredos(`[${a.severidade}] ${a.arquivo || '-'}: ${a.evidencia} → ${a.correcao}`);

export function montarPrompt({ feature, n, projeto, ficha, achados, patchAnterior, comandos: aRodar }) {
  const marca = randomUUID().slice(0, 8);
  const bloco = (nome, texto) => `<<<DADOS ${nome} ${marca}>>>\n${texto}\n<<<FIM ${nome} ${marca}>>>`;
  const comandos = (aRodar ?? normalizarComandos(feature.verificacao)).map(c => `- ${c.cmd}`).join('\n');
  return [`Feature ${feature.id}: ${feature.titulo}`, `Descrição: ${feature.descricao}`,
    `Tentativa ${n}. Comandos que o runner roda para provar (rode-os você também):`, comandos,
    bloco('ficha_projeto', projeto), bloco('ficha_feature', ficha), ...(achados ? [bloco('achados_anteriores', achados)] : []),
    ...(patchAnterior ? [bloco('patch_anterior', patchAnterior)] : [])].join('\n');
}

const LIMITE_PATCH = 8000;
const CORTE_PATCH = '\n[… patch cortado …]';
const LOCKFILE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|go\.sum|[^/]*\.lock)$/;
// Arquivos que nunca voltam ao prompt: testes, snapshots, configs, manifests, estado, segredos, lockfiles e binários.
const PROTEGIDOS = [
  LOCKFILE,
  /(^|\/)(tests?|__tests__|__mocks__|specs?|e2e|cypress|fixtures?|__snapshots__)\//,
  /\.(test|spec|e2e)\.[^/]+$/, /_(test|spec)\.[^/]+$/, /(^|\/)test_[^/]+$/,
  /\.snap(shot)?$/,
  /(^|\/)[^/]*\.config\.[^/]+$/, /(^|\/)[^/]*\.conf$/, /(^|\/)\.[^/]*rc(\.[^/]+)?$/, /(^|\/)[^/]*config[^/]*\.json$/,
  /(^|\/)(config|configs|conf|settings|\.config|\.github|\.husky|\.vscode|\.idea|\.circleci|\.devcontainer)\//,
  /\.(ya?ml|toml|ini|cfg|properties|xml|plist|gradle)$/,
  /(^|\/)(dockerfile[^/]*|docker-compose[^/]*|makefile|\.editorconfig|\.gitignore|\.gitattributes|\.gitmodules|\.npmignore|\.nvmrc|\.node-version|\.tool-versions|\.browserslistrc|procfile)$/,
  /(^|\/)(package\.json|composer\.json|go\.mod|requirements[^/]*\.txt|pipfile|gemfile|setup\.py|build\.sbt|pom\.xml)$/,
  /(^|\/)(\.maratona|\.git|\.claude|\.codex|node_modules)(\/|$)/, /(^|\/)(estado|state)[^/]*\.json$/,
  /(^|\/)\.env([.\-_][^/]*)?$/, /(^|\/)[^/]*(secrets?|credentials?)(\.[^/]+)?$/, /(^|\/)id_(rsa|dsa|ecdsa|ed25519)[^/]*$/,
  /\.(pem|key|p12|pfx|crt|cer|der|keystore|jks|gpg|asc)$/,
  /\.(png|jpe?g|gif|bmp|ico|webp|avif|tiff?|pdf|zip|gz|tgz|bz2|xz|7z|rar|jar|war|exe|dll|so|dylib|bin|wasm|class|o|a|pyc|woff2?|ttf|otf|eot|mp[34]|mov|avi|webm|ogg|wav|sqlite3?|db)$/,
];
const protegido = caminho => PROTEGIDOS.some(r => r.test(caminho.toLowerCase()));

// Caminho no formato do Git: entre aspas usa escapes C e octais (bytes UTF-8). Retorna null se não der para ler com segurança.
const ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };
function lerCitado(txt) {
  if (!txt.startsWith('"')) return null;
  const bytes = [];
  for (let i = 1; i < txt.length; i++) {
    const ch = txt[i];
    if (ch === '"') return { caminho: Buffer.from(bytes).toString('utf8'), resto: txt.slice(i + 1) };
    if (ch !== '\\') { bytes.push(...Buffer.from(ch, 'utf8')); continue; }
    const prox = txt[++i];
    if (/[0-7]/.test(prox ?? '')) {
      const oct = txt.slice(i, i + 3);
      if (!/^[0-7]{3}$/.test(oct)) return null;
      bytes.push(parseInt(oct, 8)); i += 2;
    } else if (prox in ESCAPES) bytes.push(ESCAPES[prox]);
    else return null;
  }
  return null;
}
const semPrefixo = c => c.replace(/^[abciow12]\//, '');
function lerCaminho(txt) {
  const t = txt.replace(/\t.*$/, '').replace(/\r$/, '');
  if (t === '/dev/null') return '';
  if (t.startsWith('"')) { const r = lerCitado(t); return r && !r.resto.trim() ? r.caminho : null; }
  return t || null;
}
function caminhosDoCabecalho(linha) {
  const resto = linha.slice('diff --git '.length).replace(/\r$/, '');
  if (resto.startsWith('"')) {
    const a = lerCitado(resto);
    if (!a || !a.resto.startsWith(' ')) return null;
    const b = lerCaminho(a.resto.slice(1));
    return b == null ? null : [semPrefixo(a.caminho), semPrefixo(b)];
  }
  const aspas = resto.indexOf(' "');
  if (aspas > 0) {
    const b = lerCaminho(resto.slice(aspas + 1));
    return b == null ? null : [semPrefixo(resto.slice(0, aspas)), semPrefixo(b)];
  }
  const igual = resto.match(/^[^/\s]+\/(.+) [^/\s]+\/\1$/);
  if (igual) return [igual[1], igual[1]];
  const partes = resto.split(/ (?=[abciow12]\/)/);
  return partes.length === 2 ? partes.map(semPrefixo) : null;
}
// Origem e destino de cada bloco: cabeçalho, ---/+++ e rename/copy. Qualquer caminho ilegível descarta o bloco.
export function caminhosDoBloco(bloco) {
  const linhas = bloco.split('\n');
  const caminhos = caminhosDoCabecalho(linhas[0]);
  if (!caminhos) return null;
  for (const l of linhas.slice(1)) {
    if (l.startsWith('@@')) break;
    const m = l.match(/^(?:--- |\+\+\+ |rename from |rename to |copy from |copy to )(.*)$/);
    if (!m) continue;
    const c = lerCaminho(m[1]);
    if (c == null) return null;
    if (c) caminhos.push(/^(---|\+\+\+) /.test(l) ? semPrefixo(c) : c);
  }
  return caminhos.every(c => c) ? caminhos : null;
}
const blocoUtil = b => {
  if (!b.startsWith('diff --git ') || /^(GIT binary patch|Binary files )/m.test(b)) return false;
  const caminhos = caminhosDoBloco(b);
  return !!caminhos?.length && !caminhos.some(protegido);
};

// Economia do piloto: a tentativa reprovada deixa um diff que serve de ponto de partida. Só a imediatamente anterior, tipo 'prova'
// ou tipo 'integridade' com provas_passaram === true (integridade final reprovada depois de todas as provas verdes). Histórico antigo
// ou integridade antes da prova não tem o sinal e não é elegível. Só blocos úteis: sem testes, snapshots, configs, manifests, estado,
// segredos, lockfiles ou binários (origem e destino), mascarado e limitado a 8.000 caracteres. Chega como dado delimitado.
export function patchAnterior(feature) {
  const ultima = feature.tentativas?.at(-1);
  const elegivel = ultima?.tipo === 'prova' || (ultima?.tipo === 'integridade' && ultima.provas_passaram === true);
  if (!elegivel || !ultima.patch) return null;
  let texto;
  try { texto = fs.readFileSync(ultima.patch, 'utf8'); } catch { return null; }
  const blocos = texto.split(/^(?=diff --git )/m).filter(blocoUtil);
  const limpo = mascararSegredos(blocos.join('')).trim();
  if (!limpo) return null;
  return limpo.length > LIMITE_PATCH ? limpo.slice(0, LIMITE_PATCH - CORTE_PATCH.length) + CORTE_PATCH : limpo;
}

export function fontesDoProjeto(repo) {
  const fontes = FONTES_PROJETO.flatMap(nome => {
    try { return [{ id: nome, texto: fs.readFileSync(path.join(repo, nome), 'utf8') }]; } catch { return []; }
  });
  return [...fontes, { id: 'git ls-files', texto: listarArquivos(repo) }];
}

// Adaptador do tradutor sob teto: antes de CADA chamada de modelo (inclusive a repetição interna) relê o orçamento, passa o
// limite efetivo ao motor e desconta o gasto da chamada anterior. Sem saldo, devolve erro sem chamar: o tradutor cai no resumo por script.
const SEM_SALDO = { code: -1, erro: 'sem saldo no orçamento para o tradutor', custoUsd: 0, custoEstimadoUsd: 0, usage: {}, resultado: null };

// Tradutor com custo anotado (só quando o modelo foi chamado). Custo desconhecido vira o estimado do próprio tradutor.
export async function traduzirComCusto({ repo, nome, deps, lancar, featureId, n, etapa, saldo, ...params }) {
  let gasto = 0;
  const chamarModelo = async args => {
    if (nome) conferirParada(nome);
    const disponivel = saldo ? saldo() - gasto : null;
    if (disponivel !== null && disponivel <= 0) return SEM_SALDO;
    const r = await deps.chamarModelo({ ...args, cwd: repo, ...(nome ? { onProcesso: acompanharProcesso(nome) } : {}), ...(disponivel !== null ? { tetoUsd: disponivel } : {}) });
    gasto += custoDe(r, args.modelo ?? 'haiku', estimarTokens(args.prompt ?? '')).custoUsd;
    return r;
  };
  const r = await traduzir({ biblioteca: deps.biblioteca, chamarModelo, ...params });
  const valor = r.custoUsd ?? r.custoEstimadoUsd;
  if (valor > 0) lancar({ featureId, etapa, modelo: 'haiku', custoUsd: valor, tentativa: n, ...(r.custoUsd == null ? { estimado: true } : {}) });
  return r.ficha;
}

export async function montarFichas(s) {
  const saldo = () => restanteAgora({ repo: s.repo, nome: s.nome, featureId: s.feature.id });
  const base = { repo: s.repo, nome: s.nome, deps: s.deps, lancar: e => lancarCusto(s, e), featureId: s.feature.id, n: s.n, saldo };
  const projeto = await traduzirComCusto({ ...base, etapa: 'tradutor-projeto', fontes: fontesDoProjeto(s.repo), foco: 'projeto', tipo: 'projeto' });
  const arquivos = [...new Set([...(s.feature.arquivos ?? []), ...caminhosCandidatos(s.repo, s.feature.titulo)])];
  const texto = [`titulo: ${s.feature.titulo}`, `descricao: ${s.feature.descricao}`, 'arquivos:', ...arquivos].join('\n');
  const ficha = await traduzirComCusto({ ...base, etapa: 'tradutor-feature', fontes: [{ id: `feature ${s.feature.id}`, texto }], foco: `${s.feature.id} ${s.feature.titulo}`, tipo: 'feature' });
  const achados = s.achados?.length
    ? await traduzirComCusto({ ...base, etapa: 'tradutor-achados', fontes: [{ id: 'achados', texto: s.achados.join('\n\n') }], foco: 'achados da tentativa anterior', tipo: 'achados' })
    : null;
  return { projeto, ficha, achados };
}
