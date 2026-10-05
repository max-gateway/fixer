import NextAuth from 'next-auth';
import Keycloak from 'next-auth/providers/keycloak';

// Config lazy: o mesmo image serve vários tenants, então realm/client vêm de env
// em runtime (ConfigMap + Secret do chart), não do build.
const issuer = () =>
  `${(process.env.KEYCLOAK_AUTH_SERVER_URL ?? '').replace(/\/+$/, '')}/realms/${process.env.KEYCLOAK_REALM}`;

type Token = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number; // epoch em segundos
  error?: 'RefreshTokenError';
  [k: string]: unknown;
};

async function refresh(token: Token): Promise<Token> {
  try {
    const res = await fetch(`${issuer()}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.KEYCLOAK_WEB_CLIENT_ID!,
        client_secret: process.env.KEYCLOAK_WEB_CLIENT_SECRET!,
        refresh_token: token.refreshToken!,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'refresh failed');
    return {
      ...token,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? token.refreshToken,
      expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
      error: undefined,
    };
  } catch {
    return { ...token, error: 'RefreshTokenError' };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  providers: [
    Keycloak({
      issuer: issuer(),
      clientId: process.env.KEYCLOAK_WEB_CLIENT_ID,
      clientSecret: process.env.KEYCLOAK_WEB_CLIENT_SECRET,
    }),
  ],
  pages: { signIn: '/login', error: '/login' },
  trustHost: true,
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, account }) {
      const t = token as Token;
      if (account) {
        return {
          ...t,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at,
        };
      }
      // Renova 30s antes de expirar; sem refresh token não há o que fazer.
      if (t.expiresAt && Date.now() / 1000 < t.expiresAt - 30) return t;
      return t.refreshToken ? refresh(t) : { ...t, error: 'RefreshTokenError' as const };
    },
    async session({ session, token }) {
      const t = token as Token;
      // Nota: /api/auth/session devolve isto ao navegador, então o access token
      // fica visível ao JS da página. É curto (renovado via refresh token) e é o
      // padrão do Auth.js; se virar problema, mover para sessão server-side.
      const s = session as { accessToken?: string; error?: string };
      s.accessToken = t.accessToken;
      s.error = t.error;
      return session;
    },
  },
}));

/** Access token do usuário logado, ou null (sem sessão / refresh falhou). */
export async function getAccessToken(): Promise<string | null> {
  const session = (await auth()) as { accessToken?: string; error?: string } | null;
  return session && !session.error ? (session.accessToken ?? null) : null;
}
