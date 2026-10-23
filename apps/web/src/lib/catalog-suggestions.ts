import type { InvoiceSuggestion } from './catalog';

type Get = <T>(path: string) => Promise<T>;

/**
 * Sugestões do catálogo para os itens ainda sem peça de uma nota: item → a peça da oficina já ligada à peça do catálogo daquele código de barras.
 * O catálogo é um AUXÍLIO da conciliação, nunca um requisito: qualquer falha (plataforma fora do ar, sem permissão, oficina sem catálogo) vira
 * "sem sugestões" e a nota abre do mesmo jeito. `get` é a chamada do servidor à API (injetada para o teste não depender dela).
 */
export async function loadSuggestions(get: Get, invoiceId: string, enabled: boolean): Promise<Map<string, InvoiceSuggestion>> {
  const out = new Map<string, InvoiceSuggestion>();
  if (!enabled) return out;
  try {
    const res = await get<{ suggestions?: InvoiceSuggestion[] } | null>(`/invoices/${encodeURIComponent(invoiceId)}/catalog-suggestions`);
    for (const s of res?.suggestions ?? []) if (!out.has(s.itemId)) out.set(s.itemId, s);
  } catch {
    return new Map();
  }
  return out;
}
