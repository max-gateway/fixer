import type { Rect } from './plate-guide';

// Detector leve de enquadramento, só para orientar o usuário (não é o OCR, que roda no reader).
// Procura o texto da placa: uma faixa horizontal de bordas verticais fortes (traços dos
// caracteres), com proporção larga, bem mais densa que o entorno. Gera dica, nunca bloqueia
// a captura manual.

const EDGE = 40; // diferença de cinza (0-255) que conta como borda vertical forte
const MIN_TEXT_ASPECT = 2.2; // largura / altura do texto da placa (7 caracteres: ~4,5)
const MAX_TEXT_ASPECT = 8;
const MIN_DENSITY = 0.1; // bordas fortes / área da caixa do texto
const PLATE_OVER_TEXT = 1; // a faixa de bordas já inclui as laterais da placa

export type Framing =
  | { found: false; brightness: number }
  | { found: true; brightness: number; ratio: number; dx: number; dy: number };

export type Hint = { key: 'none' | 'far' | 'near' | 'off' | 'ok'; text: string };

/** Tons de cinza (um byte por pixel) de uma região w x h; `guide` em pixels da mesma região. */
export function analyzeFraming(gray: ArrayLike<number>, w: number, h: number, guide: Rect): Framing {
  const brightness = meanInside(gray, w, h, guide);
  const strong = new Uint8Array(w * h);
  const rows = new Int32Array(h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 1; x < w - 1; x++) {
      if (Math.abs(gray[o + x + 1]! - gray[o + x - 1]!) >= EDGE) {
        strong[o + x] = 1;
        rows[y]!++;
      }
    }
  }

  // Faixa de linhas em torno do pico de bordas.
  let peak = 0;
  let peakY = -1;
  for (let y = 1; y < h - 1; y++) {
    const s = rows[y - 1]! + rows[y]! + rows[y + 1]!;
    if (s > peak) {
      peak = s;
      peakY = y;
    }
  }
  if (peakY < 0 || peak < 9) return { found: false, brightness };
  const cut = (peak / 3) * 0.45;
  let y0 = peakY;
  let y1 = peakY;
  while (y0 > 0 && rows[y0 - 1]! >= cut) y0--;
  while (y1 < h - 1 && rows[y1 + 1]! >= cut) y1++;
  const bh = y1 - y0 + 1;
  if (bh < 4) return { found: false, brightness };

  // Colunas com bordas dentro da faixa, agrupadas em trechos separados por vãos maiores que um caractere.
  const cols = new Int32Array(w);
  for (let y = y0; y <= y1; y++) for (let x = 0; x < w; x++) cols[x]! += strong[y * w + x]!;
  const minCol = Math.max(1, Math.floor(bh * 0.15));
  const maxGap = Math.max(2, Math.round(bh * 0.9));
  let best = { x0: 0, x1: -1, sum: 0 };
  let cur = { x0: -1, x1: -1, sum: 0 };
  for (let x = 0; x < w; x++) {
    if (cols[x]! < minCol) continue;
    if (cur.x1 >= 0 && x - cur.x1 <= maxGap) {
      cur.x1 = x;
      cur.sum += cols[x]!;
    } else {
      if (cur.sum > best.sum) best = cur;
      cur = { x0: x, x1: x, sum: cols[x]! };
    }
  }
  if (cur.sum > best.sum) best = cur;
  const bw = best.x1 - best.x0 + 1;
  if (bw <= 0) return { found: false, brightness };

  const aspect = bw / bh;
  const density = best.sum / (bw * bh);
  if (aspect < MIN_TEXT_ASPECT || aspect > MAX_TEXT_ASPECT || density < MIN_DENSITY) return { found: false, brightness };

  const plateW = bw * PLATE_OVER_TEXT;
  const cx = (best.x0 + best.x1) / 2;
  const cy = (y0 + y1) / 2;
  return {
    found: true,
    brightness,
    ratio: plateW / guide.w,
    dx: (cx - (guide.x + guide.w / 2)) / guide.w,
    dy: (cy - (guide.y + guide.h / 2)) / guide.h,
  };
}

export function judgeFraming(f: Framing): Hint {
  if (!f.found) return { key: 'none', text: 'Aponte para a placa' };
  if (f.ratio < 0.8) return { key: 'far', text: 'Chegue mais perto' };
  if (f.ratio > 1.25) return { key: 'near', text: 'Afaste um pouco' };
  if (Math.abs(f.dx) > 0.12 || Math.abs(f.dy) > 0.35) {
    const horizontal = Math.abs(f.dx) > Math.abs(f.dy) * 0.5;
    const arrow = horizontal ? (f.dx < 0 ? '←' : '→') : f.dy < 0 ? '↑' : '↓';
    return { key: 'off', text: `${arrow} Centralize a placa` };
  }
  return { key: 'ok', text: 'Pronto, segure firme' };
}

function meanInside(gray: ArrayLike<number>, w: number, h: number, r: Rect): number {
  const x0 = Math.max(0, Math.floor(r.x));
  const x1 = Math.min(w, Math.ceil(r.x + r.w));
  const y0 = Math.max(0, Math.floor(r.y));
  const y1 = Math.min(h, Math.ceil(r.y + r.h));
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++, n++) sum += gray[y * w + x]!;
  return n ? sum / n : 0;
}
