// ============================================================
// Tool — Legendas · 100% no navegador (burn de SRT via canvas)
// Paridade com "legendas" do Rateio Hot. Transcrição automática
// (Whisper) entra quando o usuário hospedar server/ (VITE_WHISPER_URL).
// ============================================================
import { slug } from '../lib/canvas.js';
import { processVideo, probeVideo, showVideoResult, parseCaptions, audioToWav, fmtBytes } from '../lib/video.js';
import { bindDrop, checkVideo, fileLine, outName } from '../lib/vtool.js';

const WHISPER_URL = import.meta.env.VITE_WHISPER_URL || '';

export function initCaptions(root, { toast }) {
  root.innerHTML = `
  <section class="card gated">
    <h2>Legendas <span class="badge-pro">PRO</span></h2>
    <p class="sub">Cola um SRT (ou deixa a gente transcrever) e a legenda queima no vídeo — letra grande com fundo, posição certa pra retenção.</p>
    <div class="drop" id="cp-drop">🎬 <b>Arraste o vídeo aqui</b> ou clique para escolher<input type="file" id="cp-input" accept="video/*" hidden>
      <small>MP4/MOV/WebM · 33 MB máx · 180 s máx</small></div>
    <div id="cp-info"></div>
    <div id="cp-whisperrow" class="row" style="margin-top:12px" ${WHISPER_URL ? '' : 'hidden'}>
      <button class="btn" id="cp-ws">🎙 Transcrever áudio (Whisper)</button>
      <span class="fdet">gera as legendas sozinhas a partir da fala</span>
    </div>
    ${WHISPER_URL ? '' : '<p class="note" style="margin-top:10px">Transcrição automática chega quando o servidor Whisper entrar no ar — por enquanto é colar o SRT.</p>'}
    <label class="fld" style="margin-top:14px"><span>SRT / legendas (cole aqui ou envie o arquivo)</span>
      <textarea id="cp-srt" placeholder='1&#10;00:00:00,000 --> 00:00:02,500&#10;O segredo que ninguém te conta…&#10;&#10;2&#10;00:00:02,500 --> 00:00:05,000&#10;está na primeira tela' style="min-height:120px;font-family:ui-monospace,Consolas,monospace;font-size:12px"></textarea></label>
    <div class="row" style="margin-top:10px">
      <button class="btn sm ghost" id="cp-up">📄 Enviar .srt</button><input type="file" id="cp-srtin" accept=".srt,.txt" hidden>
      <button class="btn sm ghost" id="cp-srtdl">⬇ Baixar SRT normalizado</button>
      <span class="fdet" id="cp-lines"></span>
    </div>
    <div class="row" style="margin-top:14px;gap:14px">
      <label class="fld"><span>Posição</span>
        <select id="cp-pos"><option value="b" selected>embaixo</option><option value="t">no topo</option></select></label>
      <label class="fld grow"><span>Tamanho <b id="cp-size-v">4.5%</b></span>
        <input type="range" id="cp-size" min="3" max="8" step="0.25" value="4.5"></label>
      <label class="fld"><span>Cor</span><input type="color" id="cp-color" value="#ffffff"></label>
    </div>
    <div class="row" style="margin-top:14px"><button class="btn acc" id="cp-run" disabled>💬 Queimar legenda no vídeo</button></div>
    <div class="prog" id="cp-prog" hidden><i></i></div>
    <div id="cp-res"></div>
  </section>`;

  const $ = (s) => root.querySelector(s);
  let vFile = null, vMeta = null, busy = false;
  const ta = $('#cp-srt');

  bindDrop(root, $('#cp-drop'), $('#cp-input'), async ([f]) => {
    const err = checkVideo(f); if (err) return toast(err, 'err');
    try {
      vMeta = await probeVideo(f); vFile = f;
      $('#cp-drop').style.display = 'none';
      $('#cp-info').innerHTML = `<div class="fileline" style="margin-top:14px">📎 <b>${f.name}</b><span class="fdet">${vMeta.w}×${vMeta.h} · ${fmtBytes(f.size)}</span></div>`;
      refreshRun();
    } catch { toast('Não foi possível ler o vídeo', 'err'); }
  });

  const caps = () => parseCaptions(ta.value);
  function refreshRun() {
    const n = caps().length;
    $('#cp-lines').textContent = n ? `${n} linha${n > 1 ? 's' : ''} detectada${n > 1 ? 's' : ''} ✓` : '';
    $('#cp-run').disabled = !(vFile && n);
  }
  ta.oninput = refreshRun;
  $('#cp-size').oninput = (e) => { $('#cp-size-v').textContent = (+e.target.value).toFixed(2).replace(/\.?0+$/, '') + '%'; };

  $('#cp-srtin').onchange = async () => {
    const f = $('#cp-srtin').files[0]; if (!f) return;
    ta.value = await f.text(); refreshRun(); toast('SRT carregado', 'ok'); $('#cp-srtin').value = '';
  };
  $('#cp-up').onclick = () => $('#cp-srtin').click();

  $('#cp-srtdl').onclick = () => {
    const cs = caps(); if (!cs.length) return toast('Nenhuma linha válida no SRT ainda', 'err');
    const ts = (s) => {
      const ms = Math.round(s * 1000), p = (n, l = 2) => String(n).padStart(l, '0');
      return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
    };
    const srt = cs.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([srt], { type: 'text/plain' }));
    a.download = (vFile ? outName(vFile, '') : 'legendas') + '.srt'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  // Whisper (só com VITE_WHISPER_URL configurado no build)
  if (WHISPER_URL) $('#cp-ws').onclick = async () => {
    if (!vFile || busy) return; busy = true; $('#cp-ws').disabled = true;
    $('#cp-prog').hidden = false; $('#cp-prog i').style.width = '5%';
    try {
      toast('Extraindo áudio…');
      const wav = await audioToWav(vFile);
      $('#cp-prog i').style.width = '30%';
      toast('Transcrevendo (pode levar 1–2 min)…');
      const fd = new FormData();
      fd.append('file', new Blob([wav.blob], { type: 'audio/wav' }), 'audio.wav');
      fd.append('lang', 'pt');
      const r = await fetch(`${WHISPER_URL.replace(/\/$/, '')}/transcribe`, { method: 'POST', body: fd });
      if (!r.ok) throw new Error(`Servidor respondeu ${r.status}`);
      const j = await r.json();
      ta.value = j.srt || (j.segments || []).map((g, i) => `${i + 1}\n${tsShort(g.start)} --> ${tsShort(g.end)}\n${g.text}\n`).join('\n');
      $('#cp-prog i').style.width = '100%';
      refreshRun();
      toast(`Transcrição pronta (${caps().length} linhas)`, 'ok');
    } catch (e) { toast('Whisper falhou: ' + e.message, 'err'); }
    finally { busy = false; $('#cp-ws').disabled = false; setTimeout(() => { $('#cp-prog').hidden = true; }, 600); }
  };
  const tsShort = (s) => {
    const p = (n, l = 2) => String(n).padStart(l, '0');
    return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(Math.floor(s % 60))},${String(Math.round((s % 1) * 1000)).padStart(3, '0')}`;
  };

  $('#cp-run').onclick = async () => {
    if (busy || !vFile) return; busy = true; $('#cp-run').disabled = true;
    $('#cp-prog').hidden = false; $('#cp-prog i').style.width = '2%'; $('#cp-res').innerHTML = '';
    try {
      const out = await processVideo(vFile, {
        w: vMeta.w & ~1, h: vMeta.h & ~1, bitrate: 3_500_000,
        captions: caps(), cap: { sizePct: +$('#cp-size').value, pos: $('#cp-pos').value, color: $('#cp-color').value },
      }, (p) => { $('#cp-prog i').style.width = Math.round(2 + p * 98) + '%'; });
      showVideoResult($('#cp-res'), { blob: out.blob, name: outName(vFile, '-leg'), ext: out.ext });
      toast('Legendas queimadas!', 'ok');
    } catch (e) { toast(e.message, 'err'); }
    finally { busy = false; $('#cp-run').disabled = false; }
  };
  return {};
}
