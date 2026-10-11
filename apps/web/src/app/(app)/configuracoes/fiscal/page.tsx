import { apiGet } from '@/lib/api';
import { FiscalSettingsForm, type FiscalSettings } from './fiscal-settings-form';

export default async function ConfiguracaoFiscalPage() {
  // Sem registro ainda (oficina nova): o formulário começa vazio.
  const settings = await apiGet<FiscalSettings | null>('/fiscal/settings').catch(() => null);
  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Configuração fiscal</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Dados da oficina usados na nota fiscal de serviço (NFS-e) e no preço por hora. Confira com o seu contador antes de emitir.
        </p>
      </header>
      <FiscalSettingsForm initial={settings} />
    </section>
  );
}
