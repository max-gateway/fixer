'use client';

import { Check, Copy, Ellipsis, FileDown } from 'lucide-react';
import { useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/** Menu "Mais": o que se usa pouco (chave de acesso para copiar e o XML), fora do caminho principal da nota. */
export function InvoiceMore({ id, accessKey, hasXml }: { id: string; accessKey: string; hasXml: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(accessKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Sem permissão de área de transferência: a chave continua visível para copiar à mão.
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="icon" aria-label="Mais ações da nota">
          <Ellipsis aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Chave de acesso</p>
          <p className="tabular text-xs break-all">{accessKey.replace(/(\d{4})(?=\d)/g, '$1 ')}</p>
          <Button type="button" size="sm" variant="outline" onClick={copy}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? 'Copiada' : 'Copiar chave'}
          </Button>
        </div>
        {hasXml && (
          // O proxy não repassa Content-Disposition; `download` força o salvamento em vez de abrir o XML na aba.
          <a href={`/api/invoices/${id}/xml`} download className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <FileDown aria-hidden /> Baixar XML
          </a>
        )}
      </PopoverContent>
    </Popover>
  );
}
