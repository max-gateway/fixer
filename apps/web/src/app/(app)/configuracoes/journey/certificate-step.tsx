'use client';

import { useMutation } from '@tanstack/react-query';
import { ChevronDown, Eye, EyeOff, FileKey, FileUp, Loader2, Lock, RefreshCw, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type DragEvent, type FormEvent } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { describedBy, Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { deleteJson, postJson, putJson } from '@/lib/client-api';
import { daysUntil, type FiscalStatus } from '@/lib/fiscal-import';
import { formatCnpj, shortDate } from '@/lib/invoices';
import { cn } from '@/lib/utils';
import { Note, Surface } from './ui';

const MAX_BYTES = 256 * 1024;

/** O .pfx vai em base64 no JSON: ele tem poucos KB e isso dispensa upload multipart. */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

/** Leitura dos dados de imposto na Receita (Integra Contador): `available` = o ambiente tem o serviço; `enabled` = a oficina já autorizou. */
export type ReceitaAccess = { available: boolean; enabled: boolean };

export function CertificateStep({ status, receita }: { status: FiscalStatus; receita: ReceitaAccess }) {
  const [replacing, setReplacing] = useState(false);
  const cred = status.credential;

  if (!status.keyAvailable) {
    return (
      <Note tone="error" icon={TriangleAlert}>
        <p className="font-semibold">Indisponível neste ambiente.</p>
        <p>O servidor foi iniciado sem a chave que protege o certificado (FISCAL_ENC_KEYS). Peça a quem cuida da instalação para configurá-la.</p>
      </Note>
    );
  }

  return (
    <div className="space-y-4">
      {cred && <CurrentCertificate cred={cred} replacing={replacing} onReplace={() => setReplacing(true)} />}
      {(!cred || replacing) && (
        <UploadForm
          renewing={Boolean(cred)}
          savedCnpj={status.settings?.cnpj ?? undefined}
          receita={receita}
          onDone={() => setReplacing(false)}
          onCancel={cred ? () => setReplacing(false) : undefined}
        />
      )}
    </div>
  );
}

/** O certificado guardado, como um cartão de identidade: quem é, até quando vale e quanto da validade já passou. */
function CurrentCertificate({ cred, replacing, onReplace }: { cred: NonNullable<FiscalStatus['credential']>; replacing: boolean; onReplace: () => void }) {
  const router = useRouter();
  const days = daysUntil(cred.notAfter);
  const start = new Date(cred.notBefore).getTime();
  const end = new Date(cred.notAfter).getTime();
  const used = Math.min(1, Math.max(0, (Date.now() - start) / Math.max(1, end - start)));

  const remove = useMutation({
    mutationFn: () => deleteJson('/api/fiscal/credentials', 'Não foi possível remover o certificado.'),
    onSuccess: () => router.refresh(),
  });

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl bg-brand-secondary p-5 text-white shadow-lg sm:p-6">
        <div aria-hidden className="pointer-events-none absolute -top-16 -right-10 size-56 rounded-full bg-brand/40 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15">
            <ShieldCheck aria-hidden className="size-5 text-sky-300" />
          </span>
          <Badge variant={days < 0 ? 'danger' : days <= 30 ? 'warning' : 'success'}>
            {days < 0 ? 'Vencido' : days === 0 ? 'Vence hoje' : `Vence em ${days} ${days === 1 ? 'dia' : 'dias'}`}
          </Badge>
        </div>
        <p className="relative mt-5 text-xs font-medium tracking-wide text-white/60 uppercase">e-CNPJ A1 · {cred.environment === 'PRODUCTION' ? 'Produção' : 'Homologação (testes)'}</p>
        <p className="font-display relative mt-1 line-clamp-2 text-lg leading-snug font-semibold break-words sm:text-xl">{cred.subject}</p>
        <p className="tabular relative mt-1 text-sm text-white/70">CNPJ {formatCnpj(cred.certCnpj)}</p>
        <div className="relative mt-5 space-y-1.5">
          <div className="flex justify-between text-xs text-white/60">
            <span>Validade</span>
            <span className="tabular">até {shortDate(cred.notAfter)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/15" role="presentation">
            <div className={cn('h-full rounded-full', days <= 30 ? 'bg-amber-400' : 'bg-sky-400')} style={{ width: `${Math.round(used * 100)}%` }} />
          </div>
        </div>
      </div>

      {days >= 0 && days <= 30 && (
        <Note tone="warn" icon={TriangleAlert}>
          <p>Renove antes de vencer: sem o certificado, a busca de notas para.</p>
        </Note>
      )}

      {!replacing && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onReplace}>
            {days <= 30 ? <RefreshCw aria-hidden /> : <FileKey aria-hidden />} {days <= 30 ? 'Enviar o renovado' : 'Substituir certificado'}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost" className="text-muted-foreground hover:text-destructive">
                <Trash2 aria-hidden /> Remover
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remover o certificado?</AlertDialogTitle>
                <AlertDialogDescription>
                  A busca de notas para e os dados da empresa, o perfil tributário e as regras de precificação são apagados. As notas já importadas ficam.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Manter</AlertDialogCancel>
                <AlertDialogAction className="bg-destructive bg-none shadow-none hover:bg-destructive/90" onClick={() => remove.mutate()}>
                  Sim, remover
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {remove.isPending && (
            <span role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 aria-hidden className="size-4 animate-spin" /> Removendo…
            </span>
          )}
        </div>
      )}
      {remove.error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {remove.error.message}
        </p>
      )}
    </div>
  );
}

function UploadForm({ renewing, savedCnpj, receita, onDone, onCancel }: { renewing: boolean; savedCnpj?: string; receita: ReceitaAccess; onDone: () => void; onCancel?: () => void }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [environment, setEnvironment] = useState<'PRODUCTION' | 'HOMOLOGATION'>('PRODUCTION');
  const [submitted, setSubmitted] = useState(false);
  // Autorização separada do envio do certificado (fiscal-autofill.md §7): só liga se a pessoa marcar.
  const [receitaConsent, setReceitaConsent] = useState(false);
  const [receitaWarning, setReceitaWarning] = useState<string | null>(null);

  const errors = {
    file: !file ? 'Escolha o arquivo do certificado (.pfx)' : file.size > MAX_BYTES ? 'O arquivo é grande demais para um certificado' : null,
    password: password === '' ? 'Informe a senha do certificado' : null,
  };
  const shown = submitted ? errors : { file: null, password: null };

  const upload = useMutation({
    mutationFn: async () => {
      const pfxBase64 = await toBase64(file!);
      if (!renewing) {
        const cert = await postJson<{ certCnpj: string }>('/api/fiscal/credentials/inspect', { pfxBase64, password }, 'Não foi possível ler o certificado.');
        if (cert.certCnpj !== savedCnpj) {
          // O certificado manda: a API grava o CNPJ dele e preenche empresa, município, regime e serviço pelas fontes
          // oficiais, zerando o que era da empresa anterior (docs/specs/fiscal-autofill.md §6.1).
          await postJson('/api/fiscal/autofill', { cnpj: cert.certCnpj }, 'Não foi possível salvar os dados da empresa.');
        }
      }
      const saved = await postJson('/api/fiscal/credentials', { pfxBase64, password, environment }, 'Não foi possível enviar o certificado.');
      // Agora o certificado existe no servidor: com a autorização, o preenchimento já traz a RBT12 oficial do PGDAS-D e os fatos da
      // declaração. Vale também na renovação com a autorização já ligada: o certificado novo é o que assina o termo na Receita.
      // A falha aqui não desfaz o envio (o certificado já está salvo): vira aviso, e "Buscar de novo" repete.
      const authorize = receita.available && receitaConsent && !receita.enabled;
      if (receita.available && (authorize || receita.enabled)) {
        try {
          if (authorize) await putJson('/api/fiscal/autofill/consent', { enabled: true }, 'Não foi possível salvar a autorização.');
          await postJson('/api/fiscal/autofill', {}, 'A consulta à Receita falhou agora.');
        } catch (err) {
          setReceitaWarning(`Certificado enviado, mas a busca na Receita não terminou: ${(err as Error).message} Use "Buscar de novo" na etapa de dados da empresa.`);
        }
      }
      return saved;
    },
    onSuccess: () => {
      setPassword('');
      setFile(null);
      setReceitaConsent(false);
      onDone();
      router.refresh();
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (errors.file || errors.password) return;
    upload.mutate();
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  }

  return (
    <Surface>
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <div className="space-y-1.5">
          <label
            htmlFor="pfx"
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              'flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors focus-within:ring-[3px] focus-within:ring-ring/30',
              dragging ? 'border-brand bg-brand-soft' : file ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-300 hover:border-brand/60 hover:bg-brand-soft/50',
              shown.file && 'border-destructive/60',
            )}
          >
            <span aria-hidden className={cn('grid size-11 place-items-center rounded-xl', file ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-soft text-brand')}>
              {file ? <FileKey className="size-5" /> : <FileUp className="size-5" />}
            </span>
            {file ? (
              <span className="max-w-full space-y-0.5">
                <span className="block truncate text-sm font-semibold">{file.name}</span>
                <span className="block text-xs text-muted-foreground">Toque para trocar o arquivo</span>
              </span>
            ) : (
              <span className="space-y-0.5">
                <span className="block text-sm font-semibold">{renewing ? 'Escolha o certificado renovado' : 'Escolha o certificado A1 da oficina'}</span>
                <span className="block text-xs text-muted-foreground">Arraste o arquivo .pfx ou .p12 para cá, ou toque para procurar</span>
              </span>
            )}
            <input
              {...describedBy('pfx', shown.file, true)}
              type="file"
              accept=".pfx,.p12,application/x-pkcs12"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="sr-only"
            />
          </label>
          <p id="pfx-msg" role={shown.file ? 'alert' : undefined} className={cn('text-xs', shown.file ? 'font-medium text-destructive' : 'text-muted-foreground')}>
            {shown.file ?? 'Só o e-CNPJ A1 (arquivo). Certificado em token ou cartão (A3) não funciona.'}
          </p>
        </div>

        <Field id="pfx-pass" label="Senha do certificado" error={shown.password}>
          <div className="relative sm:max-w-80">
            <Input
              {...describedBy('pfx-pass', shown.password)}
              type={reveal ? 'text' : 'password'}
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10 pr-10"
            />
            <button
              type="button"
              onClick={() => setReveal((v) => !v)}
              aria-label={reveal ? 'Ocultar senha' : 'Mostrar senha'}
              aria-pressed={reveal}
              className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-lg text-muted-foreground hover:text-foreground"
            >
              {reveal ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
            </button>
          </div>
        </Field>

        {receita.available && !receita.enabled && (
          <div className={cn('flex items-start justify-between gap-4 rounded-xl border p-4 transition-colors', receitaConsent ? 'border-brand/40 bg-brand-soft' : 'bg-slate-50')}>
            <div className="min-w-0 space-y-1">
              <label htmlFor="receita-consent-upload" className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                Buscar os impostos na Receita Federal
                <Badge variant="secondary" className="bg-brand text-white">
                  Recomendado
                </Badge>
              </label>
              <p id="receita-consent-upload-desc" className="text-xs text-muted-foreground">
                Com o certificado, o Fixer lê a RBT12 da última declaração do Simples (PGDAS-D) e calcula o imposto do preço com os números da Receita, sem digitação. Só leitura: nada é
                declarado nem pago. Atualiza todo mês e dá para desligar quando quiser.
              </p>
            </div>
            <Switch id="receita-consent-upload" aria-describedby="receita-consent-upload-desc" checked={receitaConsent} onCheckedChange={setReceitaConsent} className="mt-0.5" />
          </div>
        )}

        <Note tone="warn" icon={TriangleAlert}>
          <p>
            <strong>Nenhum outro sistema</strong> (contador, ERP) pode consultar as notas deste CNPJ ao mesmo tempo: a SEFAZ bloqueia os dois por 1 hora.
          </p>
        </Note>

        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
            Opções avançadas <ChevronDown aria-hidden className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <Field id="env" label="Ambiente da SEFAZ" hint="Use Homologação só para testar com notas sem valor fiscal.">
              <Select {...describedBy('env', null, true)} value={environment} onChange={(e) => setEnvironment(e.target.value as typeof environment)} className="sm:max-w-56">
                <option value="PRODUCTION">Produção</option>
                <option value="HOMOLOGATION">Homologação (testes)</option>
              </Select>
            </Field>
          </CollapsibleContent>
        </Collapsible>

        {receitaWarning && (
          <p role="status" className="text-sm font-medium text-amber-800">
            {receitaWarning}
          </p>
        )}
        {upload.error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {upload.error.message}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={upload.isPending}>
              Cancelar
            </Button>
          )}
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground sm:mr-auto sm:order-first">
            <Lock aria-hidden className="size-3.5 shrink-0" /> Guardados criptografados; nunca aparecem de volta.
          </p>
          <Button type="submit" size="lg" disabled={upload.isPending}>
            {upload.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <ShieldCheck aria-hidden />}
            {upload.isPending ? 'Lendo o certificado…' : renewing ? 'Enviar o renovado' : 'Enviar e buscar os dados'}
          </Button>
        </div>
      </form>
    </Surface>
  );
}
