export const ORDEM = Object.freeze(['haiku', 'sonnet', 'opus']);

function palavras(texto) {
  return String(texto ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export function classificarRisco(feature) {
  const explicito = String(feature.risco ?? '').toLowerCase();
  if (explicito === 'alto' || explicito === 'baixo') return explicito;
  const risco = new Set(['auth', 'authentication', 'autenticacao', 'autorizacao', 'login', 'senha', 'senhas',
    'token', 'tokens', 'credito', 'creditos', 'pagamento', 'pagamentos', 'cobranca', 'cobrancas',
    'webhook', 'webhooks', 'seguranca', 'migra', 'migrar', 'migracao', 'migracoes', 'banco',
    'migrate', 'migration', 'migrations', 'migrating', 'migrado', 'migrando', 'authorization', 'authenticate', 'bancos']);
  const radical = /^(autentic|autoriz|senh(?:a|as)\b|password|credenc|credential|oauth|jwt|pagament|payment|billing|stripe|cobran|webhook|seguranc|database|permiss)/;
  const termos = palavras(`${feature.titulo ?? ''} ${feature.descricao ?? ''}`);
  return termos.some((p, i) => {
    if (/^tokens?$/.test(p) && termos[i - 1] === 'design') return false;
    return risco.has(p) || radical.test(p);
  }) ? 'alto' : 'baixo';
}

export function classificarTipo(feature) {
  if (feature.tipo === 'front' || feature.tipo === 'geral') return feature.tipo;
  const arquivos = Array.isArray(feature.arquivos) ? feature.arquivos.map(a => String(a).replace(/\\/g, '/')) : [];
  if (arquivos.length === 0) return 'geral';
  const ui = a => /\.(tsx|jsx|css|scss|html|vue)$/.test(a);
  const dir = a => a.includes('/') ? a.slice(0, a.lastIndexOf('/')) : '';
  if (arquivos.every(ui)) return 'front';
  const doUi = arquivos.filter(ui);
  if (doUi.length * 2 <= arquivos.length) return 'geral';
  const dirsUi = new Set(doUi.map(dir));
  return arquivos.every(a => ui(a) || (/\.(ts|js)$/.test(a) && dirsUi.has(dir(a)))) ? 'front' : 'geral';
}

export function modeloInicial(feature) {
  return feature.modelo || (classificarTipo(feature) === 'front' || classificarRisco(feature) === 'alto' ? 'sonnet' : 'haiku');
}

function infraestrutura(tentativa) {
  if (soProva(tentativa)) return false;
  if (['tempo', 'teto'].includes(tentativa.cortadoPor)) return false;
  if (tentativa.tipo === 'infra' || tentativa.infra === true) return true;
  return /\b(ECONN\w*|ENOTFOUND|EAI_AGAIN|ETIMEDOUT)\b/i.test(String(tentativa.erro ?? ''));
}

function soProva(tentativa) {
  return tentativa.tipo === 'prova' || tentativa.falha === 'prova' || tentativa.falhaProva === true;
}

export function decidir(feature, tentativa) {
  const modelo = tentativa.modelo || modeloInicial(feature);
  const historico = (feature.tentativas ?? []).filter(t => t !== tentativa);
  const infra = infraestrutura(tentativa);
  const anteriores = historico.filter(t => !infraestrutura(t));
  if (anteriores.length + (infra ? 0 : 1) >= 4) return { acao: 'bloquear', modelo, motivo: 'Limite de quatro tentativas atingido.' };
  if (infra) {
    const limite = historico.filter(infraestrutura).length + 1 >= 3;
    return { acao: limite ? 'bloquear' : 'repetir', modelo,
      motivo: limite ? 'Três falhas de infraestrutura; feature bloqueada.' : 'Infraestrutura indisponível; não consome escalada.' };
  }
  if (classificarTipo(feature) === 'front' && modelo === 'sonnet' && (!feature.modelo || feature.modelo === 'sonnet')) {
    return { acao: 'repetir', modelo, motivo: 'Front permanece em sonnet até o limite de tentativas.' };
  }
  const indice = ORDEM.indexOf(modelo);
  if (indice < 0 || indice === ORDEM.length - 1) return { acao: 'bloquear', modelo, motivo: 'Modelo sem próxima escalada disponível.' };
  if (soProva(tentativa) && !anteriores.some(t => t.modelo === modelo && soProva(t))) {
    return { acao: 'repetir', modelo, motivo: 'Uma repetição para corrigir a prova neste modelo.' };
  }
  return { acao: 'escalar', modelo: ORDEM[indice + 1], motivo: 'Falha exige modelo seguinte.' };
}
