// ============================================================
// Tool — Áudio: extrair trilha e/ou trocar/sobrepor · 100% no navegador
// Paridade com "extrair" + "audio" do Rateio Hot (WebAudio local).
// ============================================================
import { slug } from '../lib/canvas.js';
import { processVideo, probeVideo, showVideoResult, audioToWav, fmtBytes } from '../lib/video.js';
import { bindDrop, checkVideo, fileLine, outName, isAudioFile } from '../lib/vtool.js';

export function initAudio(root, { toast }) {
  root.innerHTML = `
  <section class="card gated">
    <h2>Áudio <span class="badge-pro">PRO</span></h2>
    <p class="sub">Dois modos: extrair o áudio do vídeo, ou trocar/sobrepor a trilha (a do criativo + a sua por cima) — mixagem roda no aparelho.</p>
    <div class="opts" id="au-mode" style="margin-bottom:14px">
      <button class="opt is-on" data-m="extract">Extrair áudio</button>
      <button class="opt" data-m="overlay">Trocar / sobrepor trilha</button>
    </div>
    <div class="row" style="gap:14px">
      <div style="flex:1;min-width:240px">
        <div class="drop" id="au-vdrop">🎬 <b>Vídeo base</b><input type="file" id="au-input" accept="video/*" hidden><small>MP4/MOV/WebM · 33 MB · 180 s</small></div>
      </div>
      <div style="flex:1;min-width:240px" id="au-adropwrap">
        <div class="drop" id="au-odrop">🎵 <b>Sua trilha</b> <small>(MP3/WAV/M4A)</small><input type="file" id="au-oinput" accept="audio/*,.mp3,.m4a,.ogg" hidden></div>
      </div>
    </div>
    <div id="au-info"></div>
    <div class="row" id="au-mix" style="margin-top:14px" hidden>
      <label class="fld grow"><span>Volume do original <b id="au-vo-v">100%</b></span><input type="range" id="au-vo" min="0" max="100" value="100"></label>
      <label class="fld grow"><span>Volume da sua trilha <b id="au-vov-v">80%</b></span><input type="range" id="au-vov" min="0" max="100" value="80"></label>
      <label class="chk"><input type="checkbox" id="au-loop" checked> Repetir trilha até o fim</label>
    </div>
    <div class="row" style="margin-top:14px"><button class="btn acc" id="au-run" disabled>🎧 Processar</button></div>
    <div class="prog" id="au-prog" hidden><i></i></div>
    <div id="au-res"></div>
  </section>`;

  const $ = (s) => root.querySelector(s);
  let mode = 'extract', vFile = null, vMeta = null, oFile = null, busy = false;

  const setMode = (m) => {
    mode = m;
    $('#au-mode').querySelectorAll('.opt').forEach((o) => o.classList.toggle('is-on', o.dataset.m === m));
    $('#au-adropwrap').style.display = m === 'extract' ? 'none' : '';
    refreshRun();
  };
  $('#au-mode').querySelectorAll('.opt').forEach((o) => { o.onclick = () => setMode(o.dataset.m); });

  bindDrop(root, $('#au-vdrop'), $('#au-input'), async ([f]) => {
    const err = checkVideo(f); if (err) return toast(err, 'err');
    try { vMeta = await probeVideo(f); vFile = f; refreshRun(); info(); }
    catch { toast('Não foi possível ler o vídeo', 'err'); }
  });
  bindDrop(root, $('#au-odrop'), $('#au-oinput'), ([f]) => {
    if (!isAudioFile(f)) return toast('Escolha um áudio (MP3/WAV/M4A)', 'err');
    if (f.size > 20 * 1024 * 1024) return toast('Trilha: máx 20 MB', 'err');
    oFile = f; refreshRun(); info();
  });

  function info() {
    $('#au-info').innerHTML = [
      vFile ? fileLine(vFile.name, vMeta ? `${vMeta.w}×${vMeta.h} · ${fmtBytes(vFile.size)}` : '') : '',
      oFile && mode === 'overlay' ? fileLine(oFile.name, fmtBytes(oFile.size)) : '',
    ].filter(Boolean).join('<div style="height:6px"></div>');
  }
  function refreshRun() {
    $('#au-run').disabled = !vFile || (mode === 'overlay' && !oFile);
    $('#au-mix').hidden = mode !== 'overlay';
    $('#au-run').textContent = mode === 'extract' ? '🎵 Extrair áudio' : '🎧 Mixar e exportar';
  }
  for (const [id, vid] of [['au-vo', 'au-vo-v'], ['au-vov', 'au-vov-v']]) {
    $('#'+id).oninput = (e) => { $('#'+vid).textContent = e.target.value + '%'; };
  }

  $('#au-run').onclick = async () => {
    if (busy || !vFile) return; busy = true; $('#au-run').disabled = true;
    const prog = $('#au-prog'), bar = prog.querySelector('i');
    prog.hidden = false; bar.style.width = '5%'; $('#au-res').innerHTML = '';
    try {
      if (mode === 'extract') {
        bar.style.width = '40%';
        const { blob, dur } = await audioToWav(vFile);
        bar.style.width = '100%';
        const dl = URL.createObjectURL(blob);
        $('#au-res').innerHTML = `<div class="vidres"><audio controls src="${dl}" style="width:100%"></audio>
          <a class="btn acc" href="${dl}" download="${slug(outName(vFile, '-audio'))}.wav">⬇ Baixar WAV (${fmtBytes(blob.size)} · ${Math.round(dur)}s)</a>
          <div class="vidmeta">Áudio extraído sem tocar no vídeo. WAV é lossless — MP3 fica na fila.</div></div>`;
        setTimeout(() => URL.revokeObjectURL(dl), 4000);
        toast('Áudio extraído!', 'ok');
      } else {
        const out = await processVideo(vFile, {
          w: vMeta.w & ~1, h: vMeta.h & ~1, bitrate: 3_000_000,
          overlayAudioFile: oFile, volOriginal: +$('#au-vo').value / 100, volOverlay: +$('#au-vov').value / 100, loopOverlay: $('#au-loop').checked,
        }, (p) => { bar.style.width = Math.round(5 + p * 95) + '%'; });
        showVideoResult($('#au-res'), { blob: out.blob, name: outName(vFile, '-mix'), ext: out.ext, sizeNote: 'Vídeo com a trilha mixada (original + sua). Ouça antes de publicar.' });
        toast('Mix pronto — dá play pra conferir', 'ok');
      }
    } catch (e) { toast(e.message, 'err'); }
    finally { busy = false; $('#au-run').disabled = false; }
  };
  return {};
}
