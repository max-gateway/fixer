// Geometria do gráfico: converte números do backend em coordenadas. Nenhuma regra de negócio aqui.
export type Pt = readonly [number, number];

/**
 * Curva suave monotônica (Fritsch–Carlson): passa por todos os pontos e nunca ultrapassa
 * os valores vizinhos, então a linha não "inventa" picos entre os dias.
 */
export function smoothPath(pts: readonly Pt[]): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0]![0]},${pts[0]![1]}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1]![0] - pts[i]![0]);
    slope.push((pts[i + 1]![1] - pts[i]![1]) / (dx[i] || 1));
  }
  const m: number[] = [slope[0]!];
  for (let i = 1; i < n - 1; i++) m.push(slope[i - 1]! * slope[i]! <= 0 ? 0 : (slope[i - 1]! + slope[i]!) / 2);
  m.push(slope[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / slope[i]!;
    const b = m[i + 1]! / slope[i]!;
    const h = Math.hypot(a, b);
    if (h > 3) {
      m[i] = (3 * a * slope[i]!) / h;
      m[i + 1] = (3 * b * slope[i]!) / h;
    }
  }
  let d = `M${pts[0]![0].toFixed(2)},${pts[0]![1].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i]! / 3;
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[i + 1]!;
    d += `C${(x0 + h).toFixed(2)},${(y0 + m[i]! * h).toFixed(2)} ${(x1 - h).toFixed(2)},${(y1 - m[i + 1]! * h).toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)}`;
  }
  return d;
}

/** Fecha uma curva até a linha de base para formar a área preenchida. */
export function areaPath(curve: string, first: Pt, last: Pt, baseline: number): string {
  return `${curve}L${last[0].toFixed(2)},${baseline}L${first[0].toFixed(2)},${baseline}Z`;
}

/** Faixa entre duas curvas (ex.: intervalo de confiança da previsão). */
export function bandPath(upper: readonly Pt[], lower: readonly Pt[]): string {
  const rev = [...lower].reverse();
  return `${smoothPath(upper)}L${rev[0]![0].toFixed(2)},${rev[0]![1].toFixed(2)}${smoothPath(rev).replace(/^M[^C]*/, '')}Z`;
}

/** Índices de rótulos do eixo X espaçados por pelo menos `minGap` px, sempre incluindo o último. */
export function labelIndexes(count: number, step: number, minGap: number): number[] {
  const every = Math.max(1, Math.ceil(minGap / Math.max(step, 1)));
  const idx: number[] = [];
  for (let i = count - 1; i >= 0; i -= every) idx.unshift(i);
  return idx;
}
