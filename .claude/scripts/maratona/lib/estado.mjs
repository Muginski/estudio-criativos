import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class ErroEstado extends Error {
  constructor(mensagem, causa) {
    super(mensagem, { cause: causa });
    this.name = 'ErroEstado';
  }
}

export function caminhos() {
  const home = process.env.MARATONA_HOME || 'F:/GrupoSip/.brain/work/maratona';
  return {
    home, registro: path.join(home, 'registro.json'), trava: path.join(home, 'lock.json'),
    logs: path.join(home, 'logs'),
    diario: process.env.MARATONA_DIARIO || 'F:/GrupoSip/04-log/DIARIO.md',
    biblioteca: process.env.MARATONA_BIBLIOTECA || 'F:/GrupoSip/.brain/work/biblioteca',
  };
}

export function lerJson(arquivo, padrao) {
  let texto;
  try { texto = fs.readFileSync(arquivo, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return padrao;
    throw new ErroEstado(`Não foi possível ler o estado: ${arquivo}`, e);
  }
  try { return JSON.parse(texto); }
  catch (e) {
    const destino = `${arquivo}.corrompido-${Date.now()}-${randomUUID()}`;
    try { renomear(arquivo, destino); }
    catch (causa) { throw new ErroEstado(`Estado corrompido; falhou a quarentena: ${arquivo}`, causa); }
    throw new ErroEstado(`Estado corrompido preservado em ${destino}`, e);
  }
}

const esperar = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function renomear(origem, destino) {
  for (let tentativa = 0; ; tentativa++) {
    try { fs.renameSync(origem, destino); return; }
    catch (e) {
      if (!['EPERM', 'EBUSY'].includes(e.code) || tentativa >= 6) throw e;
      esperar(10 * (tentativa + 1));
    }
  }
}

export function gravarJsonAtomico(arquivo, obj) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const tmp = `${arquivo}.${process.pid}-${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { flag: 'wx' });
    renomear(tmp, arquivo);
  } catch (e) { throw new ErroEstado(`Não foi possível gravar o estado: ${arquivo}`, e); }
  finally { fs.rmSync(tmp, { force: true }); }
}

function pidVivo(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

function lerTrava(arquivo) {
  try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')); }
  catch (e) {
    if (e.code && e.code !== 'ENOENT') throw e;
    return null;
  }
}

function comGuarda(arquivo, executar) {
  const guarda = `${arquivo}.guarda`;
  const inicio = Date.now();
  let fd;
  while (fd === undefined) {
    try { fd = fs.openSync(guarda, 'wx'); }
    catch (e) {
      if (['EPERM', 'EBUSY'].includes(e.code) && Date.now() - inicio <= 10000) { esperar(10); continue; }
      if (e.code !== 'EEXIST') throw e;
      try {
        const dono = lerTrava(guarda);
        const idade = Date.now() - fs.statSync(guarda).mtimeMs;
        if ((dono && !pidVivo(dono.pid)) || (!dono && idade > 5000)) fs.rmSync(guarda, { force: true });
      } catch (erro) { if (!['ENOENT', 'EPERM', 'EBUSY'].includes(erro.code)) throw erro; }
      if (Date.now() - inicio > 10000) throw new ErroEstado('Tempo esgotado aguardando a guarda da trava.');
      esperar(10);
    }
  }
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid }));
    return executar();
  } finally { fs.closeSync(fd); fs.rmSync(guarda, { force: true }); }
}

const travaMaxMin = () => {
  const n = Number(process.env.MARATONA_TRAVA_MAX_MIN);
  return process.env.MARATONA_TRAVA_MAX_MIN && Number.isFinite(n) && n > 0 ? n : 360;
};

// Lease: o dono vivo renova `batida` (renovarTrava); só PID morto ou batida mais velha que 6 h (padrão) perdem a trava. Trava antiga sem batida usa `inicio`.
// Limite conhecido: PID reaproveitado pelo Windows segura a fila por até 6 h; nenhum trecho síncrono do runner chega perto disso.
export function pegarTrava(nome, { idadeMaxMin = travaMaxMin() } = {}) {
  const { home, trava } = caminhos();
  fs.mkdirSync(home, { recursive: true });
  return comGuarda(trava, () => {
    const anterior = lerTrava(trava);
    const idade = Date.now() - Date.parse(anterior?.batida ?? anterior?.inicio);
    if (anterior && pidVivo(anterior.pid) && idade < idadeMaxMin * 60000) {
      return { ok: false, motivo: `Turno já em execução (pid ${anterior.pid}).` };
    }
    fs.rmSync(trava, { force: true });
    const agora = new Date().toISOString();
    fs.writeFileSync(trava, JSON.stringify({ pid: process.pid, inicio: agora, batida: agora, nome }), { flag: 'wx' });
    return { ok: true, motivo: null };
  });
}

// Só o dono renova; devolve false se a trava já é de outro (ou sumiu).
export function renovarTrava(nome, dono = process.pid) {
  const { home, trava } = caminhos();
  if (!fs.existsSync(home)) return false;
  return comGuarda(trava, () => {
    const atual = lerTrava(trava);
    if (atual?.pid !== dono) return false;
    gravarJsonAtomico(trava, { ...atual, nome: nome ?? atual.nome, batida: new Date().toISOString() });
    return true;
  });
}

export function soltarTrava() {
  const { home, trava } = caminhos();
  if (!fs.existsSync(home)) return;
  comGuarda(trava, () => {
    if (lerTrava(trava)?.pid === process.pid) fs.rmSync(trava, { force: true });
  });
}

export function hoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function linhaDiario(texto) {
  try {
    const { diario } = caminhos();
    fs.mkdirSync(path.dirname(diario), { recursive: true });
    fs.appendFileSync(diario, `\n## [${hoje()}] maratona | ${texto}\n`);
    return true;
  } catch { return false; }
}
