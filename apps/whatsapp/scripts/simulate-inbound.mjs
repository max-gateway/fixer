#!/usr/bin/env node
/**
 * Simula a Meta entregando uma mensagem de cliente no webhook local, com a assinatura HMAC correta.
 * Exercita o caminho inteiro sem WhatsApp, ngrok nem celular:
 *   webhook -> outbox -> Redis Stream -> API (vínculo) -> order.whatsapp_linked -> confirmação ao cliente.
 *
 * Uso (a partir da raiz do repositório):
 *   node apps/whatsapp/scripts/simulate-inbound.mjs --code OS-K7Q2-X9MA --from 11987654321
 *
 * Opções:
 *   --code   código da OS (aparece na tela de sucesso/na ordem da oficina)     [obrigatório, ou use --text]
 *   --from   telefone do "cliente" (com ou sem DDI/formatação)                  [obrigatório]
 *   --text   texto livre da mensagem (padrão: a mensagem pronta do portal)
 *   --url    base do serviço (padrão: http://localhost:<PORT do .env>)
 *
 * Lê META_APP_SECRET e PORT de apps/whatsapp/.env (o secret nunca é impresso). Só para desenvolvimento.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const file = join(root, '.env');
  if (!existsSync(file)) return {};
  const env = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
  }
  return out;
}

function fail(msg) {
  console.error(`Erro: ${msg}`);
  process.exit(1);
}

const env = { ...loadEnv(), ...process.env };
const a = args(process.argv.slice(2));
if (a.help || a.h) {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  console.log(src.slice(src.indexOf('/**') + 3, src.indexOf('*/')).replace(/^ \* ?/gm, '').trim());
  process.exit(0);
}

const secret = env.META_APP_SECRET;
if (!secret) fail('META_APP_SECRET ausente em apps/whatsapp/.env (a assinatura do webhook depende dele).');
if (!a.from || a.from === true) fail('informe --from <telefone>, ex.: --from 11987654321');

let from = String(a.from).replace(/\D/g, '');
if (from.length === 10 || from.length === 11) from = `55${from}`;
if (!/^\d{12,13}$/.test(from)) fail(`telefone inválido: ${a.from}`);

const text = typeof a.text === 'string' ? a.text : a.code ? `Olá! Quero acompanhar minha OS pelo WhatsApp. Código: ${a.code}` : null;
if (!text) fail('informe --code <OS-XXXX-XXXX> (ou --text "mensagem")');

const base = String(a.url ?? `http://localhost:${env.PORT ?? 3006}`).replace(/\/$/, '');
const wamid = `wamid.SIM${randomUUID().replace(/-/g, '').slice(0, 24)}`;
const body = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'SIMULADO',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            contacts: [{ profile: { name: 'Cliente Simulado' }, wa_id: from }],
            messages: [{ id: wamid, from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
          },
        },
      ],
    },
  ],
});
const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

console.log(`POST ${base}/webhooks/meta`);
console.log(`  de: ${from.slice(0, 4)}…${from.slice(-4)}  wamid: ${wamid}`);
console.log(`  texto: ${text}`);

let res;
try {
  res = await fetch(`${base}/webhooks/meta`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
    body,
    signal: AbortSignal.timeout(10_000),
  });
} catch (err) {
  fail(`não consegui falar com ${base} (${err.message}). O serviço do whatsapp está rodando?`);
}

if (res.status === 200) {
  console.log('\nOK (200): webhook aceito. Em ~1s o evento chega à API; confira:');
  console.log('  - api.log:      "order_code_received <id> -> linked"');
  console.log('  - a ordem na oficina / o portal / a tela de sucesso mostram "WhatsApp conectado"');
} else if (res.status === 401 || res.status === 403) {
  fail(`HTTP ${res.status}: assinatura recusada. O META_APP_SECRET do .env é o mesmo que o serviço carregou? (reinicie o whatsapp se acabou de mudar)`);
} else {
  fail(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
