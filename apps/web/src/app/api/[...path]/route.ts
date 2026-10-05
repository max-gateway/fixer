// Proxy server-side para a API: evita CORS (a API não habilita) e permite ler a
// URL da API em runtime, já que a imagem é compartilhada entre tenants.
// Anexa o access token do usuário logado; sem sessão válida responde 401.
import { getAccessToken } from '@/auth';

const apiUrl = () => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

type Ctx = { params: Promise<{ path: string[] }> };

async function proxy(req: Request, ctx: Ctx) {
  const token = await getAccessToken();
  if (!token) return Response.json({ message: 'Não autenticado' }, { status: 401 });
  const { path } = await ctx.params;
  const { search } = new URL(req.url);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  try {
    const res = await fetch(`${apiUrl()}/${path.map(encodeURIComponent).join('/')}${search}`, {
      method: req.method,
      headers: {
        'content-type': req.headers.get('content-type') ?? 'application/json',
        authorization: `Bearer ${token}`,
      },
      // Bytes crus: o corpo pode ser multipart (upload de foto), não só JSON.
      body: hasBody ? await req.arrayBuffer() : undefined,
      cache: 'no-store',
    });
    return new Response(res.body, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return Response.json({ message: 'API indisponível' }, { status: 502 });
  }
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
