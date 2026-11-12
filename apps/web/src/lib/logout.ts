/** Só caminhos internos: evita open redirect via ?callbackUrl=https://... */
export function safePath(value?: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

/** Base pública do web (atrás do proxy da plataforma o `req.url` traz o host interno do contêiner, não o público). */
export function publicBase(authUrl: string | undefined, fallbackOrigin: string): string {
  return (authUrl || fallbackOrigin).replace(/\/+$/, '');
}

/**
 * Logout RP-initiated do Keycloak: encerra também a sessão do SSO (sem isso, "Continuar para o login" entra
 * direto, sem pedir senha) e volta para `/login`. O `post_logout_redirect_uri` precisa estar nos redirect URIs do client.
 * Sem `id_token_hint` o Keycloak mostra uma tela de confirmação, então ele vai sempre que houver.
 */
export function buildEndSessionUrl(opts: { issuer: string; clientId: string; base: string; idToken?: string }): string {
  const url = new URL(`${opts.issuer}/protocol/openid-connect/logout`);
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('post_logout_redirect_uri', `${opts.base}/login`);
  if (opts.idToken) url.searchParams.set('id_token_hint', opts.idToken);
  return url.toString();
}
