// Alinha os redirectUris/webOrigins do client fixer-web (Keycloak dev) com DEV_HOST do .env da raiz.
// O realm só é importado uma vez; este script cobre a troca de IP sem recriar o Keycloak.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';

// O IP da LAN vem de DHCP e muda; redetecta a cada infra:up e regrava DEV_HOST (.env)
// e KEYCLOAK_AUTH_SERVER_URL (apps/web/.env.local) para o login não quebrar ao reiniciar.
function setVar(file, key, value) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const re = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  const sep = text && !text.endsWith('\n') ? '\n' : '';
  const next = re.test(text) ? text.replace(re, line) : `${text}${sep}${line}\n`;
  if (next !== text) writeFileSync(file, next);
}
const lan = Object.values(networkInterfaces())
  .flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal && i.address.startsWith('192.168.'))?.address;
if (lan) {
  setVar('.env', 'DEV_HOST', lan);
  if (existsSync('apps/web/.env.local')) setVar('apps/web/.env.local', 'KEYCLOAK_AUTH_SERVER_URL', `http://${lan}:8180`);
}

if (existsSync('.env')) process.loadEnvFile('.env');
const host = process.env.DEV_HOST;
const base = process.env.KEYCLOAK_ADMIN_URL ?? 'http://localhost:8180';
const realm = 'fixer-dev';
const ngrok = 'https://unturpentined-lichtly-delena.ngrok-free.dev';
const origins = ['http://localhost:3001', ...(host ? [`http://${host}:3001`] : []), ngrok];

async function json(res) {
  if (!res.ok) throw new Error(`${res.url} -> ${res.status}`);
  return res.json();
}

const { access_token } = await json(
  await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: 'admin-cli', username: 'admin', password: 'admin', grant_type: 'password' }),
  }),
);
const headers = { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' };
const [client] = await json(await fetch(`${base}/admin/realms/${realm}/clients?clientId=fixer-web`, { headers }));
const redirectUris = origins.map((o) => `${o}/*`);
const same = (a, b) => [...a].sort().join() === [...b].sort().join();
if (same(client.redirectUris, redirectUris) && same(client.webOrigins, origins)) {
  console.log(`keycloak: fixer-web já alinhado (${host ?? 'localhost'})`);
} else {
  const res = await fetch(`${base}/admin/realms/${realm}/clients/${client.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ ...client, redirectUris, webOrigins: origins }),
  });
  if (!res.ok) throw new Error(`PUT client -> ${res.status}`);
  console.log(`keycloak: fixer-web atualizado para ${host ?? 'localhost'}`);
}
