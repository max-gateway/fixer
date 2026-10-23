#!/usr/bin/env node
// Cria (ou atualiza) o client confidencial que a API usa para administrar pessoas no Keycloak (Configurações → Acessos).
// Idempotente. Imprime as variáveis para o apps/api/.env.
//
//   node scripts/keycloak-access-client.mjs --realm fixer-dev [--mode organization|realm] [--url http://localhost:8180]
//                                            [--client fixer-access] [--admin admin --password admin]
//
// Papéis do service account (client realm-management): view-users e manage-users; no modo organization também
// manage-realm, que a API de Organizations do Keycloak 26 exige para listar e alterar membros.

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, all) => (cur.startsWith('--') ? [...acc, [cur.slice(2), all[i + 1]?.startsWith('--') ? 'true' : (all[i + 1] ?? 'true')]] : acc), []),
);
const url = (args.url ?? process.env.KEYCLOAK_AUTH_SERVER_URL ?? 'http://localhost:8180').replace(/\/+$/, '');
const realm = args.realm ?? process.env.KEYCLOAK_REALM;
const clientId = args.client ?? 'fixer-access';
const mode = args.mode ?? 'organization';
const adminUser = args.admin ?? process.env.KC_ADMIN_USER ?? 'admin';
const adminPassword = args.password ?? process.env.KC_ADMIN_PASSWORD ?? 'admin';

if (!realm) fail('Informe --realm');
if (!['organization', 'realm'].includes(mode)) fail('--mode deve ser organization ou realm');

const token = await (async () => {
  const res = await fetch(`${url}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: adminUser, password: adminPassword }),
  });
  if (!res.ok) fail(`Login de administrador recusado (${res.status})`);
  return (await res.json()).access_token;
})();

const api = async (method, path, body) => {
  const res = await fetch(`${url}/admin/realms/${realm}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok && res.status !== 409) fail(`${method} ${path}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

const representation = {
  clientId,
  name: 'Fixer API (controle de acesso)',
  description: 'Service account da API: convida, lista e remove pessoas da oficina',
  enabled: true,
  protocol: 'openid-connect',
  publicClient: false,
  serviceAccountsEnabled: true,
  standardFlowEnabled: false,
  directAccessGrantsEnabled: false,
  implicitFlowEnabled: false,
};

let [client] = await api('GET', `/clients?clientId=${encodeURIComponent(clientId)}`);
if (!client) {
  await api('POST', '/clients', representation);
  [client] = await api('GET', `/clients?clientId=${encodeURIComponent(clientId)}`);
  console.log(`client ${clientId} criado`);
} else {
  await api('PUT', `/clients/${client.id}`, { ...client, ...representation });
  console.log(`client ${clientId} atualizado`);
}

const sa = await api('GET', `/clients/${client.id}/service-account-user`);
const [rm] = await api('GET', '/clients?clientId=realm-management');
const wanted = ['view-users', 'manage-users', ...(mode === 'organization' ? ['manage-realm'] : [])];
const available = await api('GET', `/clients/${rm.id}/roles`);
const roles = available.filter((r) => wanted.includes(r.name));
await api('POST', `/users/${sa.id}/role-mappings/clients/${rm.id}`, roles);
console.log(`service account com: ${roles.map((r) => r.name).join(', ')}`);

const { value: secret } = await api('GET', `/clients/${client.id}/client-secret`);
console.log('\n# apps/api/.env');
console.log(`KEYCLOAK_ADMIN_CLIENT_ID=${clientId}`);
console.log(`KEYCLOAK_ADMIN_CLIENT_SECRET=${secret}`);
console.log(`ACCESS_DIRECTORY_MODE=${mode}`);

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
