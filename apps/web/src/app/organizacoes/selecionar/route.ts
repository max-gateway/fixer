// Grava a oficina escolhida. É um POST de formulário COMUM (não uma server action): a resposta é um redirect e o navegador
// recarrega a página inteira, o que descarta o cache de dados (React Query) da oficina anterior. Uma troca por navegação
// client-side deixaria telas da oficina A visíveis já com o cabeçalho da B.
import { NextResponse, type NextRequest } from 'next/server';
import { getAccessToken } from '@/auth';
import { ORG_COOKIE } from '@/lib/org';
import { listOrganizations } from '@/lib/org-server';

export async function POST(req: NextRequest) {
  // Só aceita a submissão feita pelo próprio site (o cookie de sessão é SameSite=Lax, mas trocar de oficina não deve vir de fora).
  const origin = req.headers.get('origin');
  if (origin && origin !== req.nextUrl.origin && origin !== `${req.headers.get('x-forwarded-proto') ?? 'http'}://${req.headers.get('host')}`) {
    return NextResponse.json({ message: 'Origem inválida' }, { status: 403 });
  }
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ message: 'Não autenticado' }, { status: 401 });

  const wanted = String((await req.formData()).get('org') ?? '').toLowerCase();
  // Só vale uma oficina DO PRÓPRIO usuário, segundo a API (claim do token + participação registrada). A API confere de novo a cada chamada.
  if (!(await listOrganizations()).some((o) => o.id === wanted)) {
    return NextResponse.json({ message: 'Você não participa desta oficina' }, { status: 403 });
  }

  // Redirect RELATIVO (303): atrás de proxy/ingress a origem interna da requisição não é a que o navegador enxerga.
  const res = new NextResponse(null, { status: 303, headers: { location: '/' } });
  res.cookies.set(ORG_COOKIE, wanted, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
