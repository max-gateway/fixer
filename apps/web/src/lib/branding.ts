// Branding por tenant: o mesmo image serve todos os tenants, então os valores
// vêm do ConfigMap do Helm em runtime (nunca NEXT_PUBLIC_*, que é fixado no build).
export type Branding = {
  tenantSlug: string;
  displayName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
};

// Identidade padrão do Fixer: azul elétrico + preto profundo (Max Gateway).
export const DEFAULT_PRIMARY = '#1F6BFF';
export const DEFAULT_SECONDARY = '#080D17';

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

type Rgb = [number, number, number];

function parse(hex: string): Rgb {
  const h = hex.slice(1);
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}

const toHex = (rgb: Rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

// Luminância relativa (WCAG 2.x).
function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const contrastWithWhite = (rgb: Rgb) => 1.05 / (luminance(rgb) + 0.05);

/**
 * O tenant escolhe a cor, mas o texto branco sobre ela (botões) e ela sobre branco
 * (links) precisam ser legíveis. Se não atingir o contraste mínimo, escurece aos poucos
 * até atingir, em vez de rejeitar a cor do cliente.
 */
function legibleOnWhite(hex: string, min = 4.5): string {
  let rgb = parse(hex);
  for (let i = 0; i < 40 && contrastWithWhite(rgb) < min; i++) {
    rgb = rgb.map((v) => v * 0.95) as Rgb;
  }
  return toHex(rgb);
}

const color = (value: string | undefined, fallback: string) =>
  legibleOnWhite(value && HEX.test(value) ? value : fallback);

export function getBranding(): Branding {
  return {
    tenantSlug: process.env.TENANT_SLUG ?? 'dev',
    displayName: process.env.TENANT_DISPLAY_NAME || 'Fixer',
    logoUrl: process.env.BRAND_LOGO_URL || null,
    primaryColor: color(process.env.BRAND_PRIMARY_COLOR, DEFAULT_PRIMARY),
    secondaryColor: color(process.env.BRAND_SECONDARY_COLOR, DEFAULT_SECONDARY),
  };
}
