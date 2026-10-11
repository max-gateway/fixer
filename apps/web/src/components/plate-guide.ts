// Moldura de enquadramento da leitura de placa.
//
// A moldura ocupa quase toda a largura da tela (placa grande no sensor), mas nunca mais de
// MAX_H da altura, para não estourar em telas largas. O recorte enviado NÃO pode ser justo na
// placa: o detector do reader descarta contornos acima de 35% da área da imagem
// (_MAX_PLATE_AREA_FRACTION em apps/plate-reader/app/pipeline/plate_detection.py). Com recorte de
// 1,5x a largura e 4x a altura da moldura, a placa ocupa ~17% da área (21% quando o recorte é
// limitado pela largura do quadro), com folga para o detector.
const GUIDE = { w: 0.86, aspect: 3.2, cy: 0.4, maxH: 0.22 };
const CROP_SCALE_W = 1.5;
const CROP_SCALE_H = 4;

export type Rect = { x: number; y: number; w: number; h: number };

/** Moldura em pixels do contêiner da câmera (a tela, não o quadro de vídeo). */
export function guideRect(cw: number, ch: number): Rect {
  const w = Math.min(GUIDE.w * cw, GUIDE.maxH * ch * GUIDE.aspect);
  const h = w / GUIDE.aspect;
  return { x: (cw - w) / 2, y: ch * GUIDE.cy - h / 2, w, h };
}

/**
 * Moldura em pixels do quadro de vídeo. O vídeo é exibido com object-cover no contêiner, então
 * a moldura é convertida da tela para o quadro original.
 */
export function guideInVideo(cw: number, ch: number, vw: number, vh: number): Rect {
  const scale = Math.max(cw / vw, ch / vh);
  const ox = (cw - vw * scale) / 2;
  const oy = (ch - vh * scale) / 2;
  const g = guideRect(cw, ch);
  return { x: (g.x - ox) / scale, y: (g.y - oy) / scale, w: g.w / scale, h: g.h / scale };
}

/** Região do quadro centrada na moldura, `scaleW` x a largura e `scaleH` x a altura, limitada ao quadro. */
function around(g: Rect, vw: number, vh: number, scaleW: number, scaleH: number): Rect {
  const w = Math.min(vw, g.w * scaleW);
  const h = Math.min(vh, g.h * scaleH);
  const x = Math.max(0, Math.min(vw - w, g.x + g.w / 2 - w / 2));
  const y = Math.max(0, Math.min(vh - h, g.y + g.h / 2 - h / 2));
  return { x, y, w, h };
}

/** Recorte enviado ao reader, em pixels do vídeo. */
export function guideCrop(cw: number, ch: number, vw: number, vh: number): Rect {
  const r = around(guideInVideo(cw, ch, vw, vh), vw, vh, CROP_SCALE_W, CROP_SCALE_H);
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
}

/** Região analisada ao vivo pelo detector de enquadramento (um pouco maior que o recorte em largura). */
export function analysisRegion(cw: number, ch: number, vw: number, vh: number): { region: Rect; guide: Rect } {
  const g = guideInVideo(cw, ch, vw, vh);
  const region = around(g, vw, vh, 2.2, 5);
  return { region, guide: { x: g.x - region.x, y: g.y - region.y, w: g.w, h: g.h } };
}

/** Formato Mercosul (ABC1D23) e antigo (ABC1234): posições 0-2 letras, 3 e 5-6 dígitos, 4 livre. */
export function plateCharOk(index: number, char: string): boolean {
  if (!char) return false;
  if (index < 3) return /[A-Z]/.test(char);
  if (index === 4) return /[A-Z0-9]/.test(char);
  return /[0-9]/.test(char);
}
