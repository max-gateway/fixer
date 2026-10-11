'use client';

import { Check, CircleCheck, Clock, Copy, ExternalLink, MessageCircle, Plus } from 'lucide-react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export type CreatedOrder = { id: string; number: number; portalToken: string };

const POLL_MS = 4000;

/**
 * Tela de sucesso: o cliente lê o QR code no balcão, abre o portal e toca em "Falar com a oficina". Quando
 * a mensagem chega, o número é vinculado e esta tela confirma sozinha (polling leve na ordem).
 */
export function OrderCreated({ order, phone, portalUrl, onNew }: { order: CreatedOrder; phone: string; portalUrl: string; onNew: () => void }) {
  const [copied, setCopied] = useState(false);

  type LinkState = { whatsappLinkedAt: string | null; whatsappLinkedPhone: string | null };
  const { data } = useQuery({
    queryKey: ['service-order-link', order.id],
    queryFn: async ({ signal }): Promise<LinkState> => {
      const res = await fetch(`/api/service-orders/${order.id}`, { cache: 'no-store', signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    // Para de consultar assim que o WhatsApp é vinculado; pausa com a aba oculta.
    refetchInterval: (q) => (q.state.data?.whatsappLinkedAt ? false : POLL_MS),
    refetchIntervalInBackground: false,
  });
  const linked = data?.whatsappLinkedAt ? { last4: data.whatsappLinkedPhone?.slice(-4) ?? null } : null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(portalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copie o link:', portalUrl);
    }
  }

  const digits = phone.replace(/\D/g, '');
  const whatsapp =
    digits.length >= 10
      ? `https://wa.me/55${digits}?text=${encodeURIComponent(`Olá! Acompanhe sua ordem de serviço, converse com a gente e complete seus dados por aqui: ${portalUrl}`)}`
      : null;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center gap-3">
        <CircleCheck aria-hidden className="size-8 text-emerald-600" />
        <div>
          <h1 className="text-2xl font-semibold">Ordem #{order.number} criada</h1>
          <p className="text-sm text-muted-foreground">Agora conecte o cliente: ele só precisa ler o QR code com a câmera do celular.</p>
        </div>
      </div>

      <section className="grid gap-5 rounded-xl border bg-card p-5 shadow-xs sm:grid-cols-[auto_1fr]">
        <div className="mx-auto w-fit rounded-lg border bg-white p-3">
          <QRCodeSVG value={portalUrl} size={176} level="M" role="img" aria-label="QR code do portal da ordem" />
        </div>

        <div className="space-y-4">
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            <li>O cliente lê o QR code e abre o portal da ordem.</li>
            <li>
              Toca em <span className="font-medium">Falar com a oficina</span> e envia a mensagem que já vem pronta.
            </li>
            <li>O número dele é capturado e as atualizações passam a chegar no WhatsApp.</li>
          </ol>

          <p
            role="status"
            className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ring-1 ${
              linked ? 'bg-emerald-50 text-emerald-900 ring-emerald-200' : 'bg-muted text-foreground ring-border'
            }`}
          >
            {linked ? <Check aria-hidden className="mt-0.5 size-4 shrink-0" /> : <Clock aria-hidden className="mt-0.5 size-4 shrink-0" />}
            {linked ? (
              <span>WhatsApp do cliente conectado{linked.last4 ? ` (final ${linked.last4})` : ''}.</span>
            ) : (
              <span>Aguardando o cliente enviar a mensagem{phone ? ` (cadastrado: ${phone})` : ''}…</span>
            )}
          </p>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={copy}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? 'Copiado!' : 'Copiar link'}
            </Button>
            {whatsapp && (
              <Button asChild variant="outline" size="sm">
                <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                  <MessageCircle aria-hidden /> Enviar pelo WhatsApp
                </a>
              </Button>
            )}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button asChild className="bg-brand hover:bg-brand-hover">
          <Link href={`/ordens/${order.id}`}>
            <ExternalLink aria-hidden /> Abrir a ordem
          </Link>
        </Button>
        <Button type="button" variant="outline" onClick={onNew}>
          <Plus aria-hidden /> Criar outra ordem
        </Button>
      </div>
    </div>
  );
}
