import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Falha de validação do destino do webhook: o assinante precisa corrigir a URL. */
export class UnsafeTargetError extends Error {}

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) || // link-local e metadata de nuvem (169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    a >= 224 // multicast e reservado
  );
}

function isPrivateV6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === '::1' || s === '::') return true;
  if (s.startsWith('::ffff:')) return isPrivateV4(s.slice(7));
  return s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb');
}

export const isPrivateIp = (ip: string): boolean => (isIP(ip) === 4 ? isPrivateV4(ip) : isIP(ip) === 6 ? isPrivateV6(ip) : true);

/**
 * Valida a URL do webhook contra SSRF: só https, sem credenciais na URL e SEM resolver para IP privado,
 * loopback, link-local ou metadata. Roda no cadastro E a cada envio (DNS pode mudar depois do cadastro).
 * Devolve o IP validado para o envio conectar nele direto (evita nova resolução entre checagem e uso).
 */
export async function assertSafeWebhook(rawUrl: string, allowInsecure: boolean): Promise<{ url: URL; address: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeTargetError('URL inválida');
  }
  if (url.username || url.password) throw new UnsafeTargetError('A URL não pode conter credenciais');
  if (url.protocol !== 'https:' && !(allowInsecure && url.protocol === 'http:')) throw new UnsafeTargetError('A URL do webhook precisa ser https');

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new UnsafeTargetError('Não foi possível resolver o endereço do webhook');
  if (!allowInsecure && addresses.some((a) => isPrivateIp(a.address))) throw new UnsafeTargetError('O webhook não pode apontar para endereço interno');
  return { url, address: addresses[0]!.address };
}
