'use client';

import { Check, Copy, ExternalLink, Loader2, LockKeyhole, Plug, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export const DEVELOPERS_URL = 'https://developers.mercadolivre.com.br/devcenter';

export type ConnectInput = { label: string; clientId?: string; clientSecret?: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Endereço que a oficina cadastra no app do Mercado Livre. */
  redirectUri: string;
  /** A oficina já cadastrou o app dela antes: só falta dar um nome e autorizar. */
  hasApp: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (input: ConnectInput) => void;
};

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md border bg-muted px-2 py-1.5 text-xs">{value}</code>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-brand/10 text-xs font-semibold text-brand">
        {n}
      </span>
      <div className="min-w-0 space-y-1.5 text-sm">
        <p className="font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}

/**
 * Assistente para conectar o Mercado Livre, escrito para quem nunca mexeu com isso. Primeira vez: 1) criar o aplicativo no Mercado Livre (passo a passo, com o endereço
 * de retorno para copiar), 2) colar o ID e a chave secreta que o Mercado Livre mostra, 3) dar um nome e autorizar. Quem já tem o aplicativo cadastrado só dá um nome.
 */
export function ConnectDialog({ open, onOpenChange, redirectUri, hasApp, busy, error, onSubmit }: Props) {
  const [step, setStep] = useState<1 | 2>(hasApp ? 2 : 1);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [label, setLabel] = useState('');

  const needsCredentials = !hasApp;
  const ready = label.trim() !== '' && (!needsCredentials || (clientId.trim() !== '' && clientSecret.trim() !== ''));

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle className="text-lg font-semibold">Conectar o Mercado Livre</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {needsCredentials
            ? 'Em poucos minutos você libera o Fixer para acompanhar a sua loja. Você só faz isso uma vez.'
            : 'O aplicativo da sua oficina já está cadastrado. Falta dar um nome à conta e autorizar no Mercado Livre.'}
        </DialogDescription>

        {needsCredentials && (
          <ol aria-label="Etapas" className="mt-4 flex items-center gap-2 text-xs font-medium">
            {(['Criar o aplicativo', 'Colar os dados e autorizar'] as const).map((t, i) => (
              <li key={t} aria-current={step === i + 1 ? 'step' : undefined} className={cn('rounded-full px-3 py-1', step === i + 1 ? 'bg-brand text-white' : 'bg-muted text-muted-foreground')}>
                {i + 1}. {t}
              </li>
            ))}
          </ol>
        )}

        {step === 1 && needsCredentials && (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              O Mercado Livre pede que cada loja crie o seu próprio “aplicativo”. É só um cadastro gratuito que gera dois códigos; você não precisa saber programar.
            </p>
            <ol className="space-y-4">
              <Step n={1} title="Entre no painel de desenvolvedores do Mercado Livre">
                <p className="text-muted-foreground">Use o mesmo e-mail e senha da conta de vendedor da sua loja.</p>
                <a href={DEVELOPERS_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand underline-offset-4 hover:underline">
                  Abrir o painel do Mercado Livre <ExternalLink aria-hidden className="size-3.5" />
                </a>
              </Step>
              <Step n={2} title="Crie um novo aplicativo">
                <p className="text-muted-foreground">Clique em “Criar nova aplicação”. No nome, pode usar o nome da sua oficina. Os outros campos de texto você pode preencher como achar melhor.</p>
              </Step>
              <Step n={3} title="Cole este endereço no campo de retorno (URI de redirect)">
                <p className="text-muted-foreground">É para onde o Mercado Livre devolve você depois de autorizar. Precisa ser exatamente este, sem espaços.</p>
                <CopyField label="Endereço de retorno" value={redirectUri} />
              </Step>
              <Step n={4} title="Deixe as permissões de leitura e de escrita marcadas e salve">
                <p className="text-muted-foreground">Assim o Fixer consegue ver e atualizar seus anúncios e pedidos. Ao salvar, o Mercado Livre mostra o ID do aplicativo e a chave secreta.</p>
              </Step>
            </ol>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="button" onClick={() => setStep(2)}>
                Já criei, continuar
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready) onSubmit({ label: label.trim(), ...(needsCredentials ? { clientId: clientId.trim(), clientSecret: clientSecret.trim() } : {}) });
            }}
          >
            {needsCredentials && (
              <>
                <label className="grid gap-1 text-sm font-medium">
                  ID do aplicativo
                  <Input value={clientId} onChange={(e) => setClientId(e.target.value)} inputMode="numeric" autoComplete="off" spellCheck={false} placeholder="Ex.: 1234567890123456" />
                  <span className="text-xs font-normal text-muted-foreground">No painel do Mercado Livre aparece como “App ID” ou “Client ID”: um número grande.</span>
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  Chave secreta
                  <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="off" spellCheck={false} placeholder="Cole aqui a chave secreta" />
                  <span className="text-xs font-normal text-muted-foreground">Aparece como “Secret Key” ou “Client Secret”: um código com letras e números.</span>
                </label>
                <p className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
                  <LockKeyhole aria-hidden className="mt-0.5 size-4 shrink-0" /> A chave secreta é guardada cifrada e nunca mais aparece na tela, nem para a nossa equipe.
                </p>
              </>
            )}
            <label className="grid gap-1 text-sm font-medium">
              Nome desta conta
              <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="Ex.: Loja principal" />
              <span className="text-xs font-normal text-muted-foreground">Só para você reconhecer a conta aqui no Fixer.</span>
            </label>
            <p className="text-xs text-muted-foreground">Ao continuar, abrimos o site do Mercado Livre para você confirmar o acesso. Depois você volta para cá automaticamente.</p>

            {error && (
              <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-900">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              {needsCredentials && (
                <Button type="button" variant="ghost" disabled={busy} onClick={() => setStep(1)}>
                  Voltar
                </Button>
              )}
              <Button type="submit" disabled={busy || !ready}>
                {busy ? <Loader2 aria-hidden className="animate-spin" /> : <Plug aria-hidden />} Autorizar no Mercado Livre
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
