'use client';

import { useMutation } from '@tanstack/react-query';
import { FileKey, Info, Loader2, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { describedBy, Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { deleteJson, postJson, putJson } from '@/lib/client-api';
import { daysUntil, type FiscalStatus } from '@/lib/fiscal-import';
import { formatCnpj, shortDate } from '@/lib/invoices';

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

export function CertificateCard({ status, cnpjSaved, receita }: { status: FiscalStatus; cnpjSaved: boolean; receita?: ReceitaAccess }) {
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

  // Sem certificado o CNPJ vem dele (mesmo quando já há dados salvos de um certificado removido).
  const enroll = !cred;
  return (
    <div className="max-w-xl space-y-4">
      {enroll && (
        <Note tone="info" icon={Info}>
          <p>
            {cnpjSaved
              ? 'O CNPJ vem do certificado: se for de outra empresa, os dados da empresa são atualizados sozinhos.'
              : 'Comece pelo certificado: o CNPJ vem dele e os dados da empresa são preenchidos pela consulta de CNPJ. Depois você só confere.'}
          </p>
        </Note>
      )}
      {cred && <CurrentCertificate cred={cred} onReplace={() => setReplacing(true)} replacing={replacing} />}
      {(!cred || replacing) && (
        <UploadForm
          hasCredential={Boolean(cred)}
          enroll={enroll}
          savedCnpj={status.settings?.cnpj ?? undefined}
          receita={receita}
          onDone={() => setReplacing(false)}
          onCancel={cred ? () => setReplacing(false) : undefined}
        />
      )}
    </div>
  );
}

function Note({ tone, icon: Icon, children }: { tone: 'info' | 'warn' | 'error'; icon: typeof Info; children: React.ReactNode }) {
  const style = { info: 'border-sky-200 bg-sky-50 text-sky-950', warn: 'border-amber-200 bg-amber-50 text-amber-950', error: 'border-red-200 bg-red-50 text-red-900' }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'note'} className={`flex max-w-xl items-start gap-3 rounded-xl border p-4 text-sm ${style}`}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function CurrentCertificate({ cred, onReplace, replacing }: { cred: NonNullable<FiscalStatus['credential']>; onReplace: () => void; replacing: boolean }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const days = daysUntil(cred.notAfter);

  const remove = useMutation({
    mutationFn: () => deleteJson('/api/fiscal/credentials', 'Não foi possível remover o certificado.'),
    onSuccess: () => router.refresh(),
  });

  return (
    <div className="space-y-3 rounded-xl border bg-card surface p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium">
            <ShieldCheck aria-hidden className="size-4 shrink-0 text-emerald-700" />
            <span className="truncate">{cred.subject}</span>
          </p>
          <p className="tabular mt-1 text-sm text-muted-foreground">CNPJ {formatCnpj(cred.certCnpj)}</p>
        </div>
        <Badge variant={days < 0 ? 'danger' : days <= 30 ? 'warning' : 'success'}>
          {days < 0 ? 'Vencido' : days === 0 ? 'Vence hoje' : `Vence em ${days} ${days === 1 ? 'dia' : 'dias'}`}
        </Badge>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Válido até</dt>
          <dd className="tabular font-medium">{shortDate(cred.notAfter)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Ambiente</dt>
          <dd className="font-medium">{cred.environment === 'PRODUCTION' ? 'Produção' : 'Homologação (testes)'}</dd>
        </div>
      </dl>
      {days <= 30 && days >= 0 && (
        <p className="text-sm text-amber-900">Renove o certificado antes de vencer: sem ele, a busca de notas para.</p>
      )}

      {!replacing && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onReplace}>
            <FileKey aria-hidden /> Substituir certificado
          </Button>
          {!confirm ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirm(true)}>
              <Trash2 aria-hidden /> Remover
            </Button>
          ) : (
            <span className="flex items-center gap-2 text-sm">
              Remover, parar a busca de notas e apagar os dados da empresa, o perfil tributário e as regras de precificação? As notas já importadas ficam.
              <Button type="button" variant="destructive" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
                {remove.isPending && <Loader2 aria-hidden className="animate-spin" />} Sim, remover
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirm(false)}>
                Não
              </Button>
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

function UploadForm({ hasCredential, enroll, savedCnpj, receita, onDone, onCancel }: { hasCredential: boolean; enroll?: boolean; savedCnpj?: string; receita?: ReceitaAccess; onDone: () => void; onCancel?: () => void }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
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
      if (enroll) {
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
      const authorize = Boolean(receita?.available) && receitaConsent && !receita?.enabled;
      if (receita?.available && (authorize || receita.enabled)) {
        try {
          if (authorize) await putJson('/api/fiscal/autofill/consent', { enabled: true }, 'Não foi possível salvar a autorização.');
          await postJson('/api/fiscal/autofill', {}, 'A consulta à Receita falhou agora.');
        } catch (err) {
          setReceitaWarning(`Certificado enviado, mas a busca na Receita não terminou: ${(err as Error).message} Use "Buscar de novo nas fontes oficiais".`);
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

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-xl border bg-card surface p-5 shadow-xs">
      <p className="font-medium">{hasCredential ? 'Enviar o certificado renovado' : 'Enviar o certificado A1 da oficina'}</p>

      <Note tone="warn" icon={TriangleAlert}>
        <p className="font-semibold">Antes de enviar</p>
        <ul className="list-disc space-y-1 pl-4">
          <li>Precisa ser o e-CNPJ <strong>A1</strong> (arquivo .pfx). Certificado em token ou cartão (A3) não funciona.</li>
          <li>
            <strong>Nenhum outro sistema</strong> (contador, ERP) pode consultar as notas deste CNPJ ao mesmo tempo, senão a SEFAZ bloqueia as consultas dos dois por 1 hora.
          </li>
          <li>
            As notas só começam a ser contadas a partir da <strong>primeira consulta</strong>; notas emitidas antes disso podem não vir. Ligue a sincronização logo.
          </li>
        </ul>
      </Note>

      <Field id="pfx" label="Arquivo do certificado" error={shown.file} hint=".pfx ou .p12">
        <Input
          {...describedBy('pfx', shown.file, true)}
          ref={fileRef}
          type="file"
          accept=".pfx,.p12,application/x-pkcs12"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="h-auto py-1.5 file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm file:font-medium"
        />
      </Field>
      <Field id="pfx-pass" label="Senha do certificado" error={shown.password}>
        <Input
          {...describedBy('pfx-pass', shown.password)}
          type="password"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="max-w-64"
        />
      </Field>
      {receita?.available && !receita.enabled && (
        <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
          <Checkbox id="receita-consent-upload" checked={receitaConsent} onCheckedChange={(v) => setReceitaConsent(v === true)} className="mt-0.5" />
          <label htmlFor="receita-consent-upload" className="space-y-1 text-sm">
            <span className="font-medium">Buscar os dados de imposto na Receita Federal</span>
            <span className="block text-xs text-muted-foreground">
              O Fixer usa o certificado para ler a RBT12 da última declaração do Simples (PGDAS-D) e como a receita se divide entre as atividades, e assim calcula o imposto do preço com os números da Receita, sem digitação. Só leitura: nada é declarado nem pago. Atualiza sozinho todo mês e dá para desligar quando quiser.
            </span>
          </label>
        </div>
      )}
      <Field id="env" label="Ambiente" hint="Use Homologação só para testar com notas sem valor fiscal.">
        <Select {...describedBy('env', null, true)} value={environment} onChange={(e) => setEnvironment(e.target.value as typeof environment)} className="max-w-56">
          <option value="PRODUCTION">Produção</option>
          <option value="HOMOLOGATION">Homologação (testes)</option>
        </Select>
      </Field>

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
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={upload.isPending}>
          {upload.isPending && <Loader2 aria-hidden className="animate-spin" />}
          {hasCredential ? 'Substituir certificado' : 'Enviar certificado'}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={upload.isPending}>
            Cancelar
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">O certificado e a senha são guardados criptografados e nunca aparecem de volta nesta tela.</p>
    </form>
  );
}
