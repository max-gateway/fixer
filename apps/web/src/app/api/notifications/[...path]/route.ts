// Proxy server-side para o serviço de notificações (apps/notifications), igual ao de /api/[...path]:
// o navegador nunca fala direto com o serviço nem vê a URL interna; o access token do usuário
// logado é anexado aqui. Também repassa o stream SSE (inbox em tempo real) sem bufferizar.
import { getAccessToken } from '@/auth';

const baseUrl = () => process.env.NOTIFICATIONS_URL ?? 'http://localhost:3005';

type Ctx = { params: Promise<{ path: string[] }> };

async function proxy(req: Request, ctx: Ctx) {
  const token = await getAccessToken();
  if (!token) return Response.json({ message: 'Não autenticado' }, { status: 401 });
  const { path } = await ctx.params;
  const { search } = new URL(req.url);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  try {
    const res = await fetch(`${baseUrl()}/v1/${path.map(encodeURIComponent).join('/')}${search}`, {
      method: req.method,
      headers: {
        ...(hasBody ? { 'content-type': req.headers.get('content-type') ?? 'application/json' } : {}),
        authorization: `Bearer ${token}`,
        accept: req.headers.get('accept') ?? '*/*',
      },
      body: hasBody ? await req.arrayBuffer() : undefined,
      cache: 'no-store',
      // Cliente fechou a aba/conexão => fecha o upstream (senão o SSE ficaria pendurado no serviço).
      signal: req.signal,
    });
    const headers = new Headers({ 'content-type': res.headers.get('content-type') ?? 'application/json' });
    if (headers.get('content-type')?.includes('text/event-stream')) {
      headers.set('cache-control', 'no-cache, no-transform');
      headers.set('x-accel-buffering', 'no'); // nginx do ingress não pode segurar o stream
    }
    return new Response(res.body, { status: res.status, headers });
  } catch {
    return Response.json({ message: 'Serviço de notificações indisponível' }, { status: 502 });
  }
}

export { proxy as GET, proxy as POST };
