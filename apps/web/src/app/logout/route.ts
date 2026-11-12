import { getToken } from 'next-auth/jwt';
import { NextResponse, type NextRequest } from 'next/server';
import { signOut } from '@/auth';
import { buildEndSessionUrl, publicBase } from '@/lib/logout';

// Fora do proxy.ts (matcher): precisa funcionar também com sessão expirada ou refresh quebrado.
// POST (formulário do botão "Sair") para que um link/prefetch qualquer não deslogue o usuário.
async function logout(req: NextRequest) {
  const base = publicBase(process.env.AUTH_URL, req.nextUrl.origin);
  const secure = base.startsWith('https://');
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: secure }).catch(() => null);

  // Apaga o cookie da sessão local; o redirect é nosso (o do Auth.js seguiria o host interno do contêiner).
  await signOut({ redirect: false }).catch(() => undefined);

  const issuer = `${(process.env.KEYCLOAK_AUTH_SERVER_URL ?? '').replace(/\/+$/, '')}/realms/${process.env.KEYCLOAK_REALM}`;
  const target = process.env.KEYCLOAK_AUTH_SERVER_URL
    ? buildEndSessionUrl({
        issuer,
        clientId: process.env.KEYCLOAK_WEB_CLIENT_ID ?? '',
        base,
        idToken: typeof token?.idToken === 'string' ? token.idToken : undefined,
      })
    : `${base}/login`;
  return NextResponse.redirect(target, 303);
}

export const POST = logout;
// GET cai na tela de login em vez de deslogar (evita logout por prefetch/CSRF).
export const GET = (req: NextRequest) => NextResponse.redirect(`${publicBase(process.env.AUTH_URL, req.nextUrl.origin)}/login`, 303);
