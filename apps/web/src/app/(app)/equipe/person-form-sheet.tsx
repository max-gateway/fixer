'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { maskPhone } from '@/lib/masks';
import { isValidCpf, maskCpf, type Person } from '@/lib/workforce';
import { useWorkforceActions } from './hooks';

type Props =
  | { mode: 'create'; open: boolean; person?: undefined; onClose: () => void; onSaved: (p: Person) => void }
  | { mode: 'edit'; open: boolean; person: Person; onClose: () => void; onSaved: (p: Person) => void };

const blankOf = (p?: Person) => ({
  cpf: '',
  name: p?.name ?? '',
  socialName: p?.socialName ?? '',
  email: p?.email ?? '',
  phone: p?.phone ? maskPhone(p.phone) : '',
  birthDate: p?.birthDate ?? '',
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Cadastro e edição de dados pessoais. O CPF só entra no cadastro: depois dele não muda, é a chave da pessoa na organização. */
export function PersonFormSheet(props: Props) {
  const { mode, open, person, onClose, onSaved } = props;
  const { create, update } = useWorkforceActions();
  const [f, setF] = useState(blankOf(person));
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const saving = create.isPending || update.isPending;

  useEffect(() => {
    if (open) {
      setF(blankOf(person));
      setTouched(false);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, person?.id]);

  const errors = {
    cpf: mode === 'create' && !isValidCpf(f.cpf) ? 'CPF inválido' : null,
    name: f.name.trim().length < 2 ? 'Informe o nome completo' : null,
    email: f.email.trim() && !EMAIL.test(f.email.trim()) ? 'E-mail inválido' : null,
    birthDate: f.birthDate && f.birthDate > new Date().toISOString().slice(0, 10) ? 'Data no futuro' : null,
  };
  const invalid = Object.values(errors).some(Boolean);
  const shown = (k: keyof typeof errors) => (touched ? errors[k] : null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (invalid || saving) return;
    setError(null);
    const common = {
      name: f.name.trim(),
      socialName: f.socialName.trim() || null,
      email: f.email.trim() || null,
      phone: f.phone.trim() || null,
      birthDate: f.birthDate || null,
    };
    try {
      const saved = mode === 'create' ? await create.mutateAsync({ cpf: f.cpf, ...common }) : await update.mutateAsync({ id: person.id, version: person.version, ...common });
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <SheetContent>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className="space-y-1 border-b px-6 pt-6 pb-4">
            <SheetTitle>{mode === 'create' ? 'Nova pessoa' : 'Editar dados'}</SheetTitle>
            <SheetDescription>{mode === 'create' ? 'Dados pessoais. O vínculo e a função vêm no passo seguinte.' : 'Atualize contato e nome. O CPF não muda.'}</SheetDescription>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
            {mode === 'create' && (
              <Field id="wf-cpf" label="CPF" error={shown('cpf')} hint="Fica cifrado; só quem administra a equipe vê completo.">
                <Input id="wf-cpf" inputMode="numeric" autoComplete="off" autoFocus value={f.cpf} onChange={(e) => set('cpf', maskCpf(e.target.value))} placeholder="000.000.000-00" aria-invalid={!!shown('cpf')} aria-describedby="wf-cpf-msg" className="tabular font-mono" />
              </Field>
            )}
            <Field id="wf-name" label="Nome completo" error={shown('name')}>
              <Input id="wf-name" autoComplete="off" autoFocus={mode === 'edit'} value={f.name} onChange={(e) => set('name', e.target.value)} aria-invalid={!!shown('name')} aria-describedby="wf-name-msg" />
            </Field>
            <Field id="wf-social" label="Nome social" optional hint="Se preenchido, é o nome usado no dia a dia.">
              <Input id="wf-social" autoComplete="off" value={f.socialName} onChange={(e) => set('socialName', e.target.value)} aria-describedby="wf-social-msg" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="wf-email" label="E-mail" optional error={shown('email')}>
                <Input id="wf-email" type="email" autoComplete="off" value={f.email} onChange={(e) => set('email', e.target.value)} aria-invalid={!!shown('email')} aria-describedby="wf-email-msg" />
              </Field>
              <Field id="wf-phone" label="Telefone" optional>
                <Input id="wf-phone" type="tel" inputMode="tel" autoComplete="off" value={f.phone} onChange={(e) => set('phone', maskPhone(e.target.value))} placeholder="(00) 00000-0000" className="tabular" />
              </Field>
            </div>
            <Field id="wf-birth" label="Nascimento" optional error={shown('birthDate')}>
              <Input id="wf-birth" type="date" value={f.birthDate} onChange={(e) => set('birthDate', e.target.value)} aria-invalid={!!shown('birthDate')} aria-describedby="wf-birth-msg" className="sm:w-48" />
            </Field>

            {error && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                {error}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t bg-card/60 px-6 py-4">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 aria-hidden className="animate-spin" />}
              {mode === 'create' ? 'Cadastrar' : 'Salvar'}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
