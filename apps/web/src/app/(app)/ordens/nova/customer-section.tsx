import { QrCode, Smartphone } from 'lucide-react';
import { Field, describedBy } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { maskPhone } from '@/lib/masks';
import { Section } from './section';

export function CustomerSection({ phone, error, onChange }: { phone: string; error?: string; onChange: (v: string) => void }) {
  const hint = 'Opcional. Com o número, o cliente já recebe o link da ordem no WhatsApp.';
  return (
    <Section step={1} title="Cliente" description="Nada além do celular é preciso: o próprio cliente completa o cadastro pelo link.">
      <Field id="phone" label="Celular (WhatsApp)" optional hint={hint} error={error} className="max-w-xs">
        <Input
          {...describedBy('phone', error, hint)}
          value={phone}
          onChange={(e) => onChange(maskPhone(e.target.value))}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder="(11) 98765-4321"
        />
      </Field>

      <div className="flex gap-3 rounded-lg bg-brand-soft p-3 text-sm">
        <QrCode aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
        <p>
          <span className="font-medium">Sem o número?</span> Ao criar a ordem você recebe um QR code. O cliente lê, toca em{' '}
          <span className="font-medium">Falar com a oficina</span> e envia a mensagem pronta: o número dele é capturado sozinho, sem ninguém
          digitar.
        </p>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Smartphone aria-hidden className="size-3.5" /> Se o telefone informado for diferente do WhatsApp que se conectar, a ordem não troca o número: a
        oficina é avisada na linha do tempo.
      </p>
    </Section>
  );
}
