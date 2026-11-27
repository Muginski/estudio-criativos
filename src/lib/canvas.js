// ============================================================
// Utilitários de canvas compartilhados pelas tools
// Tudo roda no cliente: zero upload, zero custo de servidor
// ============================================================

/** Formatos padrão de anúncio (largura x altura) — spec de rede social */
export const RATIOS = {
  '9:16':  { w: 1080, h: 1920, label: 'Stories / Reels / TikTok' },
  '4:5':   { w: 1080, h: 1350, label: 'Feed Instagram / Facebook' },
  '1:1':   { w: 1080, h: 1080, label: 'Feed quadrado' },
  '16:9':  { w: 1920, h: 1080, label: 'YouTube / capa / web' },
};

/** Carrega um File de imagem e devolve {img, src(natural), url(revogada no destroy)} */
export async function loadImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise((ok, fail) => {
    img.onload = ok;
    img.onerror = () => fail(new Error('Não foi possível ler a imagem'));
    img.src = url;
  });
  return { img, w: img.naturalWidth, h: img.naturalHeight, url };
}

/** Desenha fonte cobrindo o alvo com corte central (cover/crop) */
export function drawCover(ctx, src, sw, sh, tw, th) {
  const s = Math.max(tw / sw, th / sh);
  const dw = sw * s, dh = sh * s;
  ctx.drawImage(src, (tw - dw) / 2, (th - dh) / 2, dw, dh);
}

/**
 * Fonte ajustada dentro do alvo (contain) com fundo:
 *  mode 'blur'  → imagem ampliada + blur (padrão "blur padding")
 *  mode 'solid' → cor sólida
 */
export function drawContained(ctx, src, sw, sh, tw, th, mode = 'blur', color = '#10131a') {
  if (mode === 'blur') {
    ctx.save();
    ctx.filter = 'blur(42px) brightness(.55)';
    ctx.drawImage(src, -tw * 0.04, -th * 0.04, tw * 1.08, th * 1.08);
    ctx.restore();
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, tw, th);
  }
  const s = Math.min(tw / sw, th / sh) * 0.94;
  const dw = sw * s, dh = sh * s;
  ctx.drawImage(src, (tw - dw) / 2, (th - dh) / 2, dw, dh);
}

/** Exporta canvas como download */
export function download(canvas, name, type = 'image/png', quality = 0.92) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    const ext = type === 'image/jpeg' ? 'jpg' : 'png';
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, type, quality);
}

/** Nome de arquivo limpo a partir do nome original */
export function slug(name, ratio) {
  return `${String(name || 'criativo').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '-').slice(0, 40)}_${ratio.replace(':', 'x')}`;
}
