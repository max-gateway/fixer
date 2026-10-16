import { get } from 'node:https';
import { CHECKS, type Check, type CheckResult } from './checks.js';
import { decodeBody } from './html.js';

export interface CheckOutcome {
  id: string;
  table: string;
  /** ERROR = não deu para baixar o texto oficial (rede, site fora do ar). */
  status: CheckResult['status'] | 'ERROR';
  messages: string[];
}

function downloadOnce(url: string, insecure = false, redirects = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = get(url, { headers: { 'user-agent': 'Mozilla/5.0 (fixer tax-rules verify)' }, rejectUnauthorized: !insecure, timeout: 60_000 }, (res) => {
      const code = res.statusCode ?? 0;
      if (code >= 300 && code < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(downloadOnce(new URL(res.headers.location, url).toString(), insecure, redirects - 1));
        return;
      }
      if (code !== 200) {
        res.resume();
        reject(new Error(`HTTP ${code} em ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(decodeBody(Buffer.concat(chunks))));
    });
    req.on('timeout', () => req.destroy(new Error(`tempo esgotado em ${url}`)));
    req.on('error', reject);
  });
}

/** Os sites do governo derrubam conexões de vez em quando: três tentativas, com pausa curta. */
async function download(url: string, insecure = false): Promise<string> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      return await downloadOnce(url, insecure);
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last;
}

/** Baixa cada fonte uma vez (várias verificações dividem a mesma página) e roda as verificações pedidas. */
export async function runChecks(only: string[] = [], today = new Date().toISOString().slice(0, 10), checks: Check[] = CHECKS, fetcher = download): Promise<CheckOutcome[]> {
  const selected = only.length ? checks.filter((c) => only.includes(c.id) || only.includes(c.table)) : checks;
  const cache = new Map<string, Promise<string>>();
  const fetchOnce = (url: string, insecure?: boolean) => {
    let p = cache.get(url);
    if (!p) {
      p = fetcher(url, insecure);
      cache.set(url, p);
    }
    return p;
  };
  const out: CheckOutcome[] = [];
  for (const c of selected) {
    try {
      const docs: Record<string, string> = {};
      for (const s of c.sources) docs[s.key] = await fetchOnce(s.url, s.insecure);
      const r = c.run(docs, today);
      out.push({ id: c.id, table: c.table, status: r.status, messages: r.messages });
    } catch (e) {
      out.push({ id: c.id, table: c.table, status: 'ERROR', messages: [e instanceof Error ? e.message : String(e)] });
    }
  }
  return out;
}

export function formatReport(outcomes: CheckOutcome[]): string {
  const icon = { PASS: 'OK   ', FAIL: 'FALHA', WARN: 'AVISO', ERROR: 'ERRO ' } as const;
  const lines = outcomes.flatMap((o) => [`${icon[o.status]} ${o.id} (${o.table})`, ...o.messages.map((m) => `        ${m}`)]);
  const n = (s: CheckOutcome['status']) => outcomes.filter((o) => o.status === s).length;
  lines.push('', `${n('PASS')} ok, ${n('WARN')} aviso(s), ${n('FAIL')} falha(s), ${n('ERROR')} erro(s) de rede`);
  return lines.join('\n');
}

/** 0 tudo bate; 1 alguma tabela diverge do texto oficial; 2 não deu para conferir (rede). */
export function exitCode(outcomes: CheckOutcome[]): number {
  if (outcomes.some((o) => o.status === 'FAIL')) return 1;
  if (outcomes.some((o) => o.status === 'ERROR')) return 2;
  return 0;
}
