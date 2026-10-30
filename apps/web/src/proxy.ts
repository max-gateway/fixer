import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { auth } from '@/auth';

// /o/* é o portal público do cliente (a credencial é o token na URL).
// Next 16: "proxy" é o antigo middleware. Exige login em tudo, menos o fluxo do Auth.js.
const handler = auth((req) => {
  const session = req.auth as { error?: string } | null;
  if (!session || session.error) {
    const url = new URL('/login', req.nextUrl.origin);
    url.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
});

// Com a config lazy do NextAuth, auth(callback) devolve uma Promise da função (não a
// função), e o Next exige que o export `proxy` seja uma função — daí o wrapper.
export async function proxy(req: NextRequest, ev: NextFetchEvent) {
  const fn = (await handler) as unknown as (r: NextRequest, e: NextFetchEvent) => Promise<Response | undefined>;
  return fn(req, ev);
}

export const config = {
  matcher: ['/((?!api/|o/|login|logout|_next/static|_next/image|favicon.ico).*)'],
};
