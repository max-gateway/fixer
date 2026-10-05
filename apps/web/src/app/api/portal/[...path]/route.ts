// Proxy PÚBLICO do portal do cliente: encaminha /api/portal/<token>/... para a API
// (/portal/<token>/...) sem anexar credencial nenhuma — o token na URL é a credencial.
// Fica separado de api/[...path], que exige sessão e injeta o token do usuário logado.
const apiUrl = () => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

type Ctx = { params: Promise<{ path: string[] }> };

async function forward(req: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  try {
    const res = await fetch(`${apiUrl()}/portal/${path.map(encodeURIComponent).join('/')}`, {
      method: req.method,
      headers: { 'content-type': 'application/json' },
      body: hasBody ? await req.arrayBuffer() : undefined,
      cache: 'no-store',
    });
    return new Response(res.body, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return Response.json({ message: 'Serviço indisponível. Tente novamente.' }, { status: 502 });
  }
}

export { forward as GET, forward as POST, forward as PATCH, forward as PUT };
