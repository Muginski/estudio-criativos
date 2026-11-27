// Journal da execução: registro durável (fora da árvore do repo) da tentativa em andamento, para a retomada após queda.
// Um arquivo por maratona em MARATONA_HOME/execucoes/<nome>.json. Fases: base | reservada → turno → prova → sessao-limpa →
// aprovando | guardando → commitado. Apagado só depois de estado, custos e folha gravados.
// O journal NUNCA passa pela quarentena do lerJson: se estiver ilegível ou incompleto o disparo falha fechado, o arquivo
// fica no lugar e a maratona não abre trabalho novo até o dono resolver e apagá-lo.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { caminhos, ErroEstado, gravarJsonAtomico, hoje, linhaDiario } from './estado.mjs';
import { conferirParada } from './registro.mjs';

const OBRIGATORIOS = ['id', 'repo', 'featureId', 'fase'];
const pastaJournals = () => path.join(caminhos().home, 'execucoes');
export const arquivoJournal = nome => path.join(pastaJournals(), `${nome}.json`);
export const apagarJournal = nome => fs.rmSync(arquivoJournal(nome), { force: true });

// undefined = arquivo ausente. Um arquivo que existe e contém o literal null NÃO é ausência: passa por `validar` e falha fechado.
function lerBruto(arquivo) {
  let texto;
  try { texto = fs.readFileSync(arquivo, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return undefined;
    throw new ErroEstado(`Não foi possível ler o journal: ${arquivo}`, e);
  }
  try { return JSON.parse(texto); } catch (e) {
    throw new ErroEstado(`Journal ilegível (JSON inválido), preservado em ${arquivo}; resolva a transação e apague o arquivo para liberar a maratona.`, e);
  }
}

function validar(journal, arquivo) {
  const ok = journal && typeof journal === 'object' && !Array.isArray(journal) && OBRIGATORIOS.every(k => typeof journal[k] === 'string' && journal[k]);
  if (!ok) throw new ErroEstado(`Journal inválido (faltam ${OBRIGATORIOS.join(', ')}), preservado em ${arquivo}; resolva a transação e apague o arquivo para liberar a maratona.`);
  return journal;
}

export function lerJournal(nome) {
  const arquivo = arquivoJournal(nome);
  const bruto = lerBruto(arquivo);
  return bruto === undefined ? null : validar(bruto, arquivo);
}

// Todos os journals existentes, sem lançar: { nome, journal } com journal === null quando ilegível ou incompleto.
export function listarJournals() {
  if (!fs.existsSync(pastaJournals())) return [];
  return fs.readdirSync(pastaJournals()).filter(n => n.endsWith('.json')).map(n => {
    const nome = n.slice(0, -5);
    try { return { nome, journal: validar(lerBruto(path.join(pastaJournals(), n)), n) }; } catch { return { nome, journal: null }; }
  });
}

export function abrirJournal(nome, dados) {
  // `dia` fica no journal: todo replay grava os eventos sem dia próprio no mesmo ledger diário, mesmo depois da meia-noite.
  const journal = { id: randomUUID(), inicio: new Date().toISOString(), dia: hoje(), fase: 'reservada', custos: [], pid_runner: process.pid, ...dados };
  gravarJsonAtomico(arquivoJournal(nome), journal);
  return journal;
}

export function atualizarJournal(nome, mudanca) {
  const atual = lerJournal(nome);
  if (!atual) throw new Error(`Journal da execução sumiu: ${nome}`);
  const novo = { ...atual, ...mudanca };
  gravarJsonAtomico(arquivoJournal(nome), novo);
  return novo;
}

export const acompanharProcesso = nome => (pid, identidade) => {
  atualizarJournal(nome, { pid_turno: pid, inicio_turno: identidade?.inicio_turno ?? null,
    executavel_turno: identidade?.executavel_turno ?? null, marcador_turno: identidade?.marcador_turno ?? null,
    script_turno: identidade?.script_turno ?? null });
  if (pid !== null) conferirParada(nome);
};

// Aviso no DIARIO no máximo uma vez por dia e por chave (o disparo repete a cada 10 min).
export function avisarUmaVezPorDia(chave, texto) {
  const marcador = path.join(caminhos().home, 'avisos', `${hoje()}-${chave.replace(/[^a-z0-9-]/gi, '_')}.flag`);
  if (fs.existsSync(marcador)) return false;
  fs.mkdirSync(path.dirname(marcador), { recursive: true });
  fs.writeFileSync(marcador, texto);
  linhaDiario(texto);
  return true;
}
