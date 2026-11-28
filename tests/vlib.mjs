// ============================================================
// Testes headless das libs puras (roda com: node tests/vlib.mjs)
// Video/canvas/MediaRecorder exigem navegador — aqui cobrimos o
// que dá pra provar sem DOM: parser de legendas, tamanhos, ZIP.
// ============================================================
import assert from 'node:assert/strict';
import { parseCaptions, targetSize, fmtBytes, fmtSec, codecExt } from '../src/lib/video.js';
import { makeZip } from '../src/lib/zip.js';

let n = 0;
const ok = (name) => { n++; console.log(`  ✓ ${name}`); };

// ---- parseCaptions: SRT padrão ----
{
  const srt = '1\n00:00:00,000 --> 00:00:02,500\nO segredo que ninguém te conta…\n\n2\n00:00:02,500 --> 00:00:05,000\nestá na primeira tela';
  const cs = parseCaptions(srt);
  assert.equal(cs.length, 2);
  assert.equal(cs[0].start, 0);
  assert.ok(Math.abs(cs[0].end - 2.5) < 0.01, `end deve ser 2.5, veio ${cs[0].end}`);
  assert.equal(cs[1].text, 'está na primeira tela');
  ok('parseCaptions: SRT padrão (2 blocos, tempos e texto)');
}

// ---- parseCaptions: linhas curtas "início-fim texto" + continuação ----
{
  const raw = '1.0-2.4 primeira parte\nde segunda linha\n3-4.5 outra';
  const cs = parseCaptions(raw);
  assert.equal(cs.length, 2);
  assert.equal(cs[0].text, 'primeira parte de segunda linha', `continuação: ${cs[0].text}`);
  assert.ok(Math.abs(cs[0].start - 1.0) < 0.001);
  assert.equal(cs[1].end, 4.5);
  ok('parseCaptions: linhas curtas com continuação multilinha');
}

// ---- parseCaptions: entrada vazia/sujo não explode ----
{
  assert.deepEqual(parseCaptions(''), []);
  assert.deepEqual(parseCaptions('texto solto sem tempo nenhum'), []);
  ok('parseCaptions: vazio e sem tempos → []');
}

// ---- targetSize ----
{
  assert.deepEqual(targetSize(1080, 1920), { w: 1080, h: 1920 }, '9:16 nativo mantém 1080×1920');
  assert.deepEqual(targetSize(1920, 1080), { w: 1440, h: 810 }, '16:9 escala pra 1440 de largura');
  assert.deepEqual(targetSize(1081, 1921, { w: 1081, h: 1921 }), { w: 1080, h: 1920 }, 'explícito → pares');
  ok('targetSize: 9:16 nativo, 16:9 escala, explícito arredonda p/ par');
}

// ---- makeZip: estrutura válida (magic, EOCD, contagem, nomes) ----
{
  const enc = new TextEncoder();
  const z = makeZip([
    { name: 'a-video.webm', data: enc.encode('conteudo-A') },
    { name: 'b-video.webm', data: enc.encode('conteudo-B-mais-longo') },
  ]);
  assert.equal(z.type, 'application/zip');
  const buf = new Uint8Array(await z.arrayBuffer());
  const u8 = (i) => buf[i];
  assert.ok(u8(0) === 0x50 && u8(1) === 0x4b && u8(2) === 3 && u8(3) === 4, 'magic local file header');
  // End of Central Directory nos últimos 22 bytes
  const eocd = new DataView(buf.buffer, buf.length - 22);
  assert.equal(eocd.getUint32(0, true), 0x06054b50, 'assinatura EOCD');
  assert.equal(eocd.getUint16(8, true), 2, 'EOCD conta 2 entradas');
  const txt = new TextDecoder().decode(buf);
  assert.ok(txt.includes('a-video.webm') && txt.includes('b-video.webm'), 'nomes presentes no zip');
  assert.ok(txt.includes('conteudo-A') && txt.includes('conteudo-B-mais-longo'), 'conteúdo presente no zip');
  ok('makeZip: magic, EOCD, contagem de entradas, nomes e conteúdo');
}

// ---- utilidades de formatação ----
{
  assert.equal(fmtSec(75), '1:15');
  assert.equal(fmtBytes(2 * 1048576), '2.0 MB');
  assert.equal(fmtBytes(512 * 1024), '512 KB');
  assert.equal(fmtBytes(2048), '2 KB');
  assert.equal(codecExt('video/mp4;codecs="avc1.42E01E"'), 'mp4');
  assert.equal(codecExt('video/webm;codecs=vp9'), 'webm');
  ok('fmtSec/fmtBytes/codecExt');
}

console.log(`\n${n} grupos passaram.`);
