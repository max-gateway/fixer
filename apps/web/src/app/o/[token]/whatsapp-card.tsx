import { Icon } from '@/components/icons';
import type { PortalOrder } from '@/lib/portal';

/**
 * Vínculo da ordem com o WhatsApp do cliente. O botão abre o WhatsApp com a mensagem (e o código da
 * OS) já escrita: o cliente só toca em enviar, e o número dele é capturado do lado da oficina sem
 * ninguém digitar nada. O estado é atualizado pelo polling do portal.
 */
export function WhatsappCard({ whatsapp, readOnly }: { whatsapp: PortalOrder['whatsapp']; readOnly: boolean }) {
  if (whatsapp.linked) {
    return (
      <p role="status" className="flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
        <Icon name="check" className="size-4 shrink-0" />
        <span>
          WhatsApp conectado{whatsapp.phoneLast4 ? ` (final ${whatsapp.phoneLast4})` : ''}. Você recebe as atualizações por lá.
        </span>
      </p>
    );
  }
  if (readOnly || !whatsapp.url) return null;

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-card surface p-4 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold">Receba as atualizações no WhatsApp</h2>
        <p className="mt-0.5 text-sm text-slate-600">Toque no botão e envie a mensagem que já vem pronta. Leva 5 segundos e você não precisa digitar nada.</p>
      </div>
      <a
        href={whatsapp.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500"
      >
        <Icon name="send" className="size-4" /> Falar com a oficina
      </a>
    </section>
  );
}
