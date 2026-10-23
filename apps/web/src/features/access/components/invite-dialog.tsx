'use client';

import { Loader2, MailPlus, TriangleAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { describedBy, Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { useAccessActions } from '../hooks';
import { effective, roleStyle } from '../model';
import type { Catalog, Role, Seats } from '../types';
import { errorText, RoleChip } from './bits';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Props = { open: boolean; onOpenChange: (o: boolean) => void; roles: Role[]; catalog: Catalog; seats: Seats };

/** Convite por e-mail já com os papéis: a pessoa recebe o link para definir a senha e entra com o acesso pronto. */
export function InviteDialog({ open, onOpenChange, roles, catalog, seats }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">{open && <Form roles={roles} catalog={catalog} seats={seats} onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function Form({ roles, catalog, seats, onDone }: Omit<Props, 'open' | 'onOpenChange'> & { onDone: () => void }) {
  const { toast } = useToast();
  const { invite } = useAccessActions();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const [another, setAnother] = useState(false);

  const emailError = touched && !EMAIL.test(email.trim()) ? 'Informe um e-mail válido' : null;
  const rolesError = touched && roleIds.length === 0 ? 'Escolha ao menos um papel' : null;
  const full = seats.max !== null && seats.used >= seats.max;
  const total = catalog.groups.reduce((n, g) => n + g.permissions.length, 0);
  const granted = effective(roleIds, roles).size;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!EMAIL.test(email.trim()) || roleIds.length === 0) return;
    try {
      const res = await invite.mutateAsync({ email: email.trim(), name: name.trim() || undefined, roleIds });
      toast(
        res.emailSent
          ? { title: 'Convite enviado', description: `${email.trim()} vai receber o link para definir a senha.` }
          : res.accountCreated
            ? { title: 'Acesso criado, mas o e-mail não saiu', description: 'O login não conseguiu enviar o e-mail (verifique o SMTP do Keycloak). Use "Reenviar convite" depois.', tone: 'info', duration: 9000 }
            : { title: 'Acesso liberado', description: `${email.trim()} já tinha conta: é só entrar com a senha de sempre.` },
      );
      if (another) {
        setEmail('');
        setName('');
        setTouched(false);
      } else onDone();
    } catch (err) {
      toast({ title: errorText(err), tone: 'error' });
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div className="flex items-start gap-3 pr-8">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
          <MailPlus aria-hidden className="size-5" />
        </span>
        <div>
          <DialogTitle>Convidar pessoa</DialogTitle>
          <DialogDescription>Ela recebe um e-mail para definir a senha e já entra com os papéis escolhidos.</DialogDescription>
        </div>
      </div>

      {full && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-900 ring-1 ring-red-600/15">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          O plano já está com {seats.used} de {seats.max} usuários ativos. Desative alguém ou mude de plano para convidar.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="invite-email" label="E-mail" error={emailError} className="sm:col-span-2">
          <Input {...describedBy('invite-email', emailError)} type="email" autoComplete="off" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@oficina.com.br" />
        </Field>
        <Field id="invite-name" label="Nome" optional hint="Aparece no e-mail e na lista até a pessoa entrar." className="sm:col-span-2">
          <Input {...describedBy('invite-name', null, true)} value={name} onChange={(e) => setName(e.target.value)} placeholder="Como a equipe chama esta pessoa" />
        </Field>
      </div>

      <fieldset className="space-y-2">
        <legend className="flex w-full items-baseline justify-between text-sm font-medium">
          Papéis
          <span className="text-xs font-normal text-muted-foreground tabular">
            {granted} de {total} permissões
          </span>
        </legend>
        <div className="flex flex-wrap gap-1.5" role="group" aria-describedby={rolesError ? 'invite-roles-msg' : undefined}>
          {roles.map((r) => {
            const on = roleIds.includes(r.id);
            return (
              <button
                key={r.id}
                type="button"
                aria-pressed={on}
                onClick={() => setRoleIds((ids) => (on ? ids.filter((x) => x !== r.id) : [...ids, r.id]))}
                style={on ? roleStyle(r) : undefined}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-sm font-medium transition-all focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
                  on ? 'shadow-xs ring-1 ring-current/20' : 'bg-card text-muted-foreground hover:border-foreground/25 hover:text-foreground',
                )}
              >
                {r.name}
              </button>
            );
          })}
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${total ? (granted / total) * 100 : 0}%` }} />
        </div>
        {rolesError && (
          <p id="invite-roles-msg" role="alert" className="text-xs font-medium text-destructive">
            {rolesError}
          </p>
        )}
        {roleIds.length > 0 && (
          <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            Vai entrar como {roleIds.map((id) => roles.find((r) => r.id === id)).filter(Boolean).map((r) => <RoleChip key={r!.id} role={r!} />)}
          </p>
        )}
      </fieldset>

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={another} onChange={(e) => setAnother(e.target.checked)} className="size-4 accent-[var(--brand-primary)]" />
          Convidar outra em seguida
        </label>
        <Button type="submit" disabled={invite.isPending || full}>
          {invite.isPending ? <Loader2 className="animate-spin" /> : <MailPlus />} Enviar convite
        </Button>
      </div>
    </form>
  );
}
