import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import type { FiscalFieldProvenance, FiscalValueConfidence, FiscalValueSource, Prisma } from '@fixer/db';
import { CNAE_LC116_META, internalModalRatePct, normalizeCnae, serviceItemForCnae } from '@fixer/tax-rules';
import { z } from 'zod';
import { CnpjLookupService } from '../cnpj-lookup/cnpj-lookup.service.js';
import { cnpjBase, isValidCnpj, normalizeCnpj } from '../fiscal-inbound/cnpj.js';
import { CredentialService, type Actor } from '../fiscal-inbound/credentials/credential.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { IntegraContadorClient } from './integra-contador.client.js';
import { NfseParametrosClient, nationalServiceCode } from './nfse-parametros.client.js';
import { sameValue, upsertProvenance, type AutofillField, type ProvenanceWrite } from './provenance.js';
import { estimateRbt12, estimateWindow } from './rbt12-estimate.js';
import { conferirSimples } from './simples-conferencia.js';

export const RunAutofillSchema = z.object({
  /** CNPJ do certificado no envio (pode ser de outra empresa); omitido = atualizar o CNPJ já salvo. */
  cnpj: z.string().optional(),
});

/** Código IBGE da UF (cUF) por sigla. */
const UF_CODE: Record<string, number> = {
  AC: 12, AL: 27, AP: 16, AM: 13, BA: 29, CE: 23, DF: 53, ES: 32, GO: 52, MA: 21, MT: 51, MS: 50, MG: 31, PA: 15,
  PB: 25, PR: 41, PE: 26, PI: 22, RJ: 33, RN: 24, RS: 43, RO: 11, RR: 14, SC: 42, SP: 35, SE: 28, TO: 17,
};
const UF_SIGLA = Object.fromEntries(Object.entries(UF_CODE).map(([s, c]) => [c, s])) as Record<number, string>;

/** O que aconteceu com cada campo. CONFLITO = a fonte discorda de um valor digitado, que fica (R1). */
export type FieldOutcome = 'PREENCHIDO' | 'IGUAL' | 'CONFLITO' | 'LIMPO' | 'SEM_DADO';
export interface FieldResult {
  field: AutofillField;
  outcome: FieldOutcome;
  value: string | null;
  /** Valor salvo antes, quando difere (CONFLITO, PREENCHIDO por cima de valor automático, LIMPO). */
  previous?: string | null;
  source?: FiscalValueSource;
  confidence?: FiscalValueConfidence;
}
export type StepId = 'CNPJ_LOOKUP' | 'SERVICO' | 'ISS' | 'REGIME' | 'RBT12' | 'ICMS_VENDA';
export interface StepResult {
  step: StepId;
  status: 'OK' | 'SEM_DADO' | 'FALHOU' | 'PULADO' | 'AGUARDANDO_CONSENTIMENTO';
  detail?: string;
}
/** EMPRESA = outra raiz de CNPJ (zera regime e perfil de imposto); MUNICIPIO = outro estabelecimento (zera o que é do local). */
export type ResetKind = 'NENHUM' | 'MUNICIPIO' | 'EMPRESA';
export interface AutofillReport {
  cnpj: string;
  reset: ResetKind;
  steps: StepResult[];
  fields: FieldResult[];
  /** Regime continua sem valor: a tela faz a pergunta guiada (§6.2). */
  needsRegime: boolean;
  simplesOptant: boolean | null;
}

const MUNICIPAL_FIELDS = ['municipalityIbge', 'issRate', 'municipalServiceCode', 'cnae', 'lc116Item'] as const;
const COMPANY_TAX_PROFILE_RESET = {
  rbt12: null,
  rbt12AsOf: null,
  icmsSalePct: null,
  simplesEffectiveRatePct: null,
  icmsSharePct: null,
  pisSharePct: null,
  cofinsSharePct: null,
  stateTaxRegular: null,
  reviewedBy: null,
  reviewedAt: null,
} satisfies Prisma.TenantTaxProfileUpdateManyMutationInput;

const str = (v: unknown): string | null => (v == null ? null : String(v));

/**
 * Preenche a configuração fiscal a partir das fontes oficiais (docs/specs/fiscal-autofill.md). Fase F0: consulta de CNPJ,
 * serviço pela CNAE e ICMS padrão da UF no Presumido. Síncrono: as fontes da F0 respondem em segundos; o job em fila
 * entra com as consultas pagas (F2). Cada passo falha sozinho, sem desfazer os outros.
 */
@Injectable()
export class FiscalAutofillService {
  private readonly logger = new Logger(FiscalAutofillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lookup: CnpjLookupService,
    private readonly credentials: CredentialService,
    @Optional() private readonly nfse?: NfseParametrosClient,
    @Optional() private readonly integra?: IntegraContadorClient,
  ) {}

  async run(input: z.infer<typeof RunAutofillSchema>, actor: Actor): Promise<AutofillReport> {
    const orgId = TenantContext.require();
    const before = await this.prisma.tenantFiscalSettings.findUnique({ where: { orgId } });
    const cnpj = input.cnpj ? normalizeCnpj(input.cnpj) : before?.cnpj;
    if (!cnpj || !isValidCnpj(cnpj)) throw new BadRequestException(input.cnpj ? 'CNPJ inválido' : 'Envie o certificado ou cadastre o CNPJ antes');

    const reset: ResetKind = !before?.cnpj || before.cnpj === cnpj ? 'NENHUM' : cnpjBase(before.cnpj) === cnpjBase(cnpj) ? 'MUNICIPIO' : 'EMPRESA';
    const steps: StepResult[] = [];
    const fields: FieldResult[] = [];

    // 1. Consulta de CNPJ. Falhou: segue só com o CNPJ (conveniência, nunca bloqueia o envio do certificado).
    let found: Awaited<ReturnType<CnpjLookupService['lookup']>> | null = null;
    try {
      found = await this.lookup.lookup(cnpj);
      steps.push({ step: 'CNPJ_LOOKUP', status: 'OK' });
    } catch (err) {
      this.logger.warn(`Consulta de CNPJ falhou no preenchimento automático: ${(err as Error).message}`);
      steps.push({ step: 'CNPJ_LOOKUP', status: 'FALHOU', detail: 'Não foi possível consultar o CNPJ agora.' });
    }
    const uf = found?.endereco?.uf?.toUpperCase() ?? null;
    const legalName = found?.razao_social?.trim().slice(0, 200) || undefined;
    const ufCode = uf ? UF_CODE[uf] : undefined;
    // Dados cadastrais seguem a Receita (como antes); o guard de troca de raiz com certificado fica no CredentialService.
    await this.credentials.updateSettings({ cnpj, ...(legalName ? { legalName } : {}), ...(ufCode ? { ufCode } : {}) }, actor);

    if (reset !== 'NENHUM') await this.resetFor(orgId, reset);
    const current = (await this.prisma.tenantFiscalSettings.findUnique({ where: { orgId } }))!;
    const provs = new Map((await this.prisma.fiscalFieldProvenance.findMany()).map((p) => [p.field, p]));

    const data: Prisma.TenantFiscalSettingsUpdateInput = {};
    const writes: ProvenanceWrite[] = [];
    const apply: Apply = (field, currentValue, next, w) => {
      const r = decide(field, currentValue, next, provs.get(field));
      fields.push({ ...r, ...(r.outcome === 'PREENCHIDO' || r.outcome === 'IGUAL' ? { source: w.source, confidence: w.confidence } : {}) });
      if (r.outcome === 'PREENCHIDO') (data as Record<string, unknown>)[field] = next;
      if (r.outcome === 'PREENCHIDO' || (r.outcome === 'IGUAL' && provs.get(field)?.source !== 'MANUAL')) writes.push({ field, ...w });
      return r;
    };

    // Município, Simples e CNAE (consulta de CNPJ).
    const simples = found?.fiscal.simples ?? null;
    let regime = current.taxRegime as string | null;
    if (found) {
      apply('municipalityIbge', current.municipalityIbge, found.fiscal.municipalityIbge, { source: 'CNPJ_LOOKUP', confidence: 'OFICIAL' });
      if (simples === true) {
        if (apply('taxRegime', regime, 'SIMPLES', { source: 'CNPJ_LOOKUP', confidence: 'OFICIAL' }).outcome === 'PREENCHIDO') regime = 'SIMPLES';
      } else if (simples === false && regime === 'SIMPLES') {
        // Saiu do Simples. Valor automático é limpo; valor digitado fica e vira aviso.
        if (provs.get('taxRegime')?.source === 'MANUAL' || !provs.get('taxRegime')) fields.push({ field: 'taxRegime', outcome: 'CONFLITO', value: null, previous: 'SIMPLES' });
        else {
          fields.push({ field: 'taxRegime', outcome: 'LIMPO', value: null, previous: 'SIMPLES', source: 'CNPJ_LOOKUP', confidence: 'OFICIAL' });
          data.taxRegime = null;
          regime = null;
          writes.push({ field: 'taxRegime', source: 'CNPJ_LOOKUP', confidence: 'OFICIAL', evidence: { simples: false } });
        }
      } else if (regime === null) fields.push({ field: 'taxRegime', outcome: 'SEM_DADO', value: null });
      if (simples !== null) writes.push({ field: 'simplesOptant', source: 'CNPJ_LOOKUP', confidence: 'OFICIAL', evidence: { optant: simples } });

      const cnae = found.cnae_principal?.codigo ? normalizeCnae(found.cnae_principal.codigo) : null;
      apply('cnae', current.cnae, cnae, { source: 'CNPJ_LOOKUP', confidence: 'OFICIAL', reference: found.cnae_principal?.descricao ?? null });

      // 2. Serviço padrão pela CNAE (regra do Fixer sobre texto oficial). Principal de comércio (autopeças) com serviço
      // de oficina nas secundárias: vale a primeira secundária da tabela. Nenhuma: 14.01, estimado.
      const principal = serviceItemForCnae(cnae);
      const secondary = principal ? null : (found.fiscal.secondaryCnaes ?? []).map((c) => serviceItemForCnae(c)).find((e) => e !== null) ?? null;
      const entry = principal ?? secondary;
      const ref = `${CNAE_LC116_META.id}@${CNAE_LC116_META.version}`;
      apply('lc116Item', current.lc116Item, entry?.lc116Item ?? '14.01', entry ? { source: 'TAX_RULES_DEFAULT', confidence: 'INFERIDO', reference: `CNAE ${secondary ? 'secundária ' : ''}${entry.cnae} (${ref})` } : { source: 'TAX_RULES_DEFAULT', confidence: 'ESTIMADO', reference: ref, evidence: { cnae, motivo: 'CNAE sem item na tabela' } });
      steps.push({ step: 'SERVICO', status: entry ? 'OK' : 'SEM_DADO', ...(entry ? {} : { detail: 'Nenhuma CNAE da empresa tem serviço na tabela: usado o 14.01 (manutenção de veículos).' }) });
    } else {
      steps.push({ step: 'SERVICO', status: 'PULADO', detail: 'Sem a consulta de CNPJ, a CNAE não é conhecida.' });
    }

    // Valor em vigor depois do que este run já decidiu gravar.
    const eff = (f: 'municipalityIbge' | 'lc116Item') => (f in data ? (data[f] as string | null) : current[f]);
    const today = new Date().toISOString().slice(0, 10);

    // 3. ISS pela NFS-e Nacional (parâmetros municipais), com o certificado da oficina. Sem consentimento extra: lê só a
    // alíquota pública do município (nfse-parametros-municipais.md §6).
    const ibge = eff('municipalityIbge');
    const item = eff('lc116Item');
    if (!this.nfse?.enabled) steps.push({ step: 'ISS', status: 'PULADO', detail: 'Consulta à NFS-e Nacional desligada neste ambiente.' });
    else if (!ibge || !item) steps.push({ step: 'ISS', status: 'PULADO', detail: 'Sem município ou serviço, não dá para consultar a prefeitura.' });
    else await this.issStep(ibge, item, today, current.issRate, apply, fields, steps);

    // 4. Receita Federal (Integra Contador), só com o consentimento da oficina (fiscal-autofill.md §7).
    const integraOn = Boolean(this.integra?.enabled);
    const consent = integraOn ? Boolean((await this.prisma.fiscalCredential.findFirst({ select: { taxDataConsent: true } }))?.taxDataConsent) : false;
    if (regime === null && simples === false) {
      if (!integraOn) steps.push({ step: 'REGIME', status: 'PULADO', detail: 'Consulta à Receita (Integra Contador) não contratada: responda o regime.' });
      else if (!consent) steps.push({ step: 'REGIME', status: 'AGUARDANDO_CONSENTIMENTO', detail: 'Autorize a busca dos dados de imposto na Receita para identificar o regime.' });
      else {
        const year = Number(today.slice(0, 4));
        const r = await this.integra!.regime(cnpj, `${year - 1}-${today.slice(5, 7)}`, today.slice(0, 7));
        if (r.status === 'OK' && (r.data.regimeInferido === 'PRESUMIDO' || r.data.regimeInferido === 'REAL')) {
          if (apply('taxRegime', regime, r.data.regimeInferido, { source: 'INTEGRA_PAGAMENTOS', confidence: 'INFERIDO', reference: r.data.motivo }).outcome === 'PREENCHIDO') regime = r.data.regimeInferido;
          steps.push({ step: 'REGIME', status: 'OK' });
        } else steps.push(integraStep('REGIME', r, 'Os pagamentos não decidem o regime: responda a pergunta.'));
      }
    } else steps.push({ step: 'REGIME', status: 'PULADO' });

    // 5. RBT12 (Simples): PGDAS-D pelo Integra Contador; sem ele, estimativa pelas OS do Fixer, que nunca substitui valor
    // oficial nem digitado.
    let profileWrite: { rbt12: string; rbt12AsOf: Date } | null = null;
    if (regime === 'SIMPLES') {
      const profileNow = await this.prisma.tenantTaxProfile.findFirst();
      const before = profileNow?.rbt12 ?? null;
      let official = false;
      if (integraOn && consent) {
        const pa = today.slice(0, 7).replace('-', '');
        const r = await this.integra!.rbt12(cnpj, pa);
        if (r.status === 'OK') {
          official = true;
          // A referência cita o período da DECLARAÇÃO lida (m-1 ou m-2); `pa` é o período a que a RBT12 resultante se aplica.
          const declared = typeof r.data.fatos?.periodoDeclaracao === 'string' ? r.data.fatos.periodoDeclaracao : r.data.pa;
          const ref = `PGDAS-D ${declared.slice(4)}/${declared.slice(0, 4)}${r.data.numeroDeclaracao ? `, declaração ${r.data.numeroDeclaracao}` : ''}`;
          // Evidência para o motor tributário: RBT12 real × proporcional e o mix da declaração (Anexos, ST, monofásico...).
          // A conferência mede se a tabela do Fixer reproduz a alíquota que a própria Receita declarou (spec §8.2).
          const conferencia = conferirSimples(r.data.fatos);
          const evidence = {
            rbt12Real: r.data.rbt12Real ?? r.data.rbt12,
            proporcional: r.data.proporcional ?? false,
            ...(r.data.mesesAtividade !== undefined ? { mesesAtividade: r.data.mesesAtividade } : {}),
            ...(r.data.fatos ? { fatos: r.data.fatos } : {}),
            conferencia,
          } as unknown as Prisma.InputJsonObject;
          if (conferencia.status === 'DIVERGE') this.logger.warn(`Tabela do Simples diverge da declaração ${r.data.numeroDeclaracao ?? ''}: ${JSON.stringify(conferencia.itens.filter((i) => !i.confere))}`);
          if (apply('rbt12', before, r.data.rbt12, { source: 'INTEGRA_PGDASD', confidence: 'OFICIAL', reference: ref, evidence }).outcome === 'PREENCHIDO') {
            profileWrite = { rbt12: r.data.rbt12, rbt12AsOf: new Date(`${r.data.pa.slice(0, 4)}-${r.data.pa.slice(4)}-01T00:00:00Z`) };
          }
          steps.push(conferencia.status === 'DIVERGE'
            ? { step: 'RBT12', status: 'OK', detail: 'A alíquota calculada pelo Fixer não bate com a da declaração na Receita: peça ao contador para conferir antes de confiar no preço.' }
            : { step: 'RBT12', status: 'OK' });
        } else if (r.status !== 'SEM_DADO') steps.push(integraStep('RBT12', r, ''));
      }
      if (!official) {
        const prov = provs.get('rbt12');
        // Estimativa só preenche vazio ou troca outra estimativa: nunca valor oficial ou digitado (sem proveniência = digitado).
        const mayEstimate = before == null ? prov?.source !== 'MANUAL' : prov?.source === 'FIXER_ESTIMATE';
        if (!mayEstimate) {
          if (!steps.some((x) => x.step === 'RBT12')) steps.push({ step: 'RBT12', status: 'OK', detail: 'RBT12 já informada.' });
        } else {
          const est = await this.estimate();
          if (est === null) {
            if (!steps.some((x) => x.step === 'RBT12')) steps.push({ step: 'RBT12', status: 'FALHOU', detail: 'Não foi possível somar as ordens de serviço agora.' });
          } else if (est.ok) {
            const value = est.rbt12.toString();
            if (apply('rbt12', before, value, { source: 'FIXER_ESTIMATE', confidence: 'ESTIMADO', reference: `OS de ${est.from} a ${est.to}`, evidence: { orders: est.orders } }).outcome === 'PREENCHIDO') {
              profileWrite = { rbt12: value, rbt12AsOf: est.asOf };
            }
            if (!steps.some((x) => x.step === 'RBT12')) steps.push({ step: 'RBT12', status: 'OK', detail: 'Estimada pelas ordens de serviço: a declaração do PGDAS-D só vem pela Receita (Integra Contador).' });
          } else {
            fields.push({ field: 'rbt12', outcome: 'SEM_DADO', value: str(before) });
            if (!steps.some((x) => x.step === 'RBT12')) steps.push({ step: 'RBT12', status: 'SEM_DADO', detail: est.detail });
          }
        }
      }
    } else steps.push({ step: 'RBT12', status: 'PULADO' });

    // 6. ICMS da venda no Presumido: alíquota interna padrão da UF, só quando o campo está vazio.
    let icmsWrite: { pct: string } | null = null;
    if (regime === 'PRESUMIDO') {
      const profile = await this.prisma.tenantTaxProfile.findFirst();
      const pct = internalModalRatePct(uf ?? (current.ufCode ? UF_SIGLA[current.ufCode] : null));
      if (profile?.icmsSalePct != null) {
        fields.push({ field: 'icmsSalePct', outcome: 'IGUAL', value: profile.icmsSalePct.toString() });
        steps.push({ step: 'ICMS_VENDA', status: 'OK', detail: 'ICMS da venda já informado.' });
      } else if (pct) {
        icmsWrite = { pct };
        fields.push({ field: 'icmsSalePct', outcome: 'PREENCHIDO', value: pct, source: 'TAX_RULES_DEFAULT', confidence: 'ESTIMADO' });
        writes.push({ field: 'icmsSalePct', source: 'TAX_RULES_DEFAULT', confidence: 'ESTIMADO', reference: `alíquota interna modal ${uf ?? UF_SIGLA[current.ufCode!]}` });
        steps.push({ step: 'ICMS_VENDA', status: 'OK' });
      } else {
        fields.push({ field: 'icmsSalePct', outcome: 'SEM_DADO', value: null });
        steps.push({ step: 'ICMS_VENDA', status: 'SEM_DADO', detail: 'Sem alíquota interna da UF no Fixer: informe a do seu contador.' });
      }
    } else {
      steps.push({ step: 'ICMS_VENDA', status: 'PULADO' });
    }

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(data).length) await tx.tenantFiscalSettings.update({ where: { orgId }, data });
      if (icmsWrite) {
        // Campo vazio ganhando valor muda o imposto: a validação do contador cai, como em saveTaxProfile.
        const reviewReset = { icmsSalePct: icmsWrite.pct, reviewedBy: null, reviewedAt: null };
        const prev = await tx.tenantTaxProfile.findFirst();
        if (prev) await tx.tenantTaxProfile.update({ where: { orgId: prev.orgId }, data: reviewReset });
        else await tx.tenantTaxProfile.create({ data: { icmsSalePct: icmsWrite.pct } });
      }
      if (profileWrite) {
        // RBT12 nova muda a alíquota: o aceite antigo cai (R3). Vinda do PGDAS-D, a fonte oficial passa a garantir o perfil.
        const prev = await tx.tenantTaxProfile.findFirst();
        if (prev) await tx.tenantTaxProfile.update({ where: { orgId: prev.orgId }, data: { ...profileWrite, reviewedBy: null, reviewedAt: null } });
        else await tx.tenantTaxProfile.create({ data: profileWrite });
      }
      for (const w of writes) await upsertProvenance(tx, orgId, w);
      await tx.fiscalAuditLog.create({
        data: { userId: actor.id, ip: actor.ip, action: 'autofill.run', detail: { cnpj, reset, steps: steps.map((s) => `${s.step}:${s.status}`), fields: fields.map((f) => `${f.field}:${f.outcome}`) } },
      });
    });

    return { cnpj, reset, steps, fields, needsRegime: regime === null, simplesOptant: simples };
  }

  /** Alíquota de ISS da prefeitura para o serviço da oficina. Falha não derruba o resto do preenchimento. */
  private async issStep(ibge: string, item: string, today: string, currentIss: unknown, apply: Apply, fields: FieldResult[], steps: StepResult[]) {
    const code = nationalServiceCode(item);
    let material;
    try {
      material = await this.credentials.openMaterial();
    } catch {
      steps.push({ step: 'ISS', status: 'PULADO', detail: 'O certificado não está disponível nesta API para consultar a prefeitura.' });
      return;
    }
    try {
      const r = await this.nfse!.aliquota(material, ibge, code, today);
      if (r.current && r.current.pct >= 2 && r.current.pct <= 5) {
        const since = r.current.from.split('-').reverse().join('/');
        const label = code.replace(/(\d{2})(\d{2})(\d{2})/, '$1.$2.$3');
        apply('issRate', currentIss, String(r.current.pct), { source: 'NFSE_PARAMETROS', confidence: 'OFICIAL', reference: `serviço ${label}, vigente desde ${since}`, evidence: { ibge, cTribNac: code, ...r.current } });
        steps.push({ step: 'ISS', status: 'OK' });
      } else {
        fields.push({ field: 'issRate', outcome: 'SEM_DADO', value: str(currentIss) });
        const why = r.current
          ? `A prefeitura informa ${r.current.pct}%, fora da faixa legal de 2% a 5%: confira com o contador.`
          : r.message
            ? `A NFS-e Nacional respondeu: ${r.message}`
            : 'A prefeitura não cadastrou a alíquota deste serviço na NFS-e Nacional.';
        steps.push({ step: 'ISS', status: 'SEM_DADO', detail: why });
      }
    } catch (err) {
      this.logger.warn(`Parâmetros municipais falharam: ${(err as Error).message}`);
      steps.push({ step: 'ISS', status: 'FALHOU', detail: 'Não foi possível consultar a NFS-e Nacional agora.' });
    }
  }

  /** RBT12 pelas OS concluídas; null quando a consulta falha. */
  private async estimate() {
    try {
      const now = new Date();
      const w = estimateWindow(now);
      const done = { status: { in: ['COMPLETED', 'DELIVERED'] as ('COMPLETED' | 'DELIVERED')[] } };
      const [first, orders] = await Promise.all([
        this.prisma.serviceOrder.findFirst({ where: { ...done, closedAt: { not: null } }, orderBy: { closedAt: 'asc' }, select: { closedAt: true } }),
        this.prisma.serviceOrder.findMany({
          where: { ...done, closedAt: { gte: w.from, lt: w.to } },
          select: { closedAt: true, partLines: { select: { quantity: true, unitPrice: true } }, serviceLines: { select: { price: true, hoursActual: true } } },
        }),
      ]);
      // `closedAt` existe em toda OS do filtro; o cast só estreita o tipo.
      return estimateRbt12(now, first?.closedAt ?? null, orders as Parameters<typeof estimateRbt12>[2]);
    } catch (err) {
      this.logger.warn(`Estimativa da RBT12 falhou: ${(err as Error).message}`);
      return null;
    }
  }

  /** Liga ou desliga a busca dos dados de imposto na Receita (fiscal-autofill.md §7). */
  async setConsent(enabled: boolean, actor: Actor) {
    const cred = await this.prisma.fiscalCredential.findFirst({ select: { orgId: true } });
    if (!cred) throw new BadRequestException('Envie o certificado antes de autorizar a consulta à Receita');
    await this.prisma.$transaction(async (tx) => {
      await tx.fiscalCredential.update({ where: { orgId: cred.orgId }, data: enabled ? { taxDataConsent: true, taxDataConsentAt: new Date(), taxDataConsentById: actor.id } : { taxDataConsent: false, taxDataConsentAt: null, taxDataConsentById: null } });
      await tx.fiscalAuditLog.create({ data: { userId: actor.id, ip: actor.ip, action: enabled ? 'autofill.consent.on' : 'autofill.consent.off', detail: {} } });
    });
    return this.provenance();
  }

  /** O que já se sabe da origem de cada campo, para a tela. */
  async provenance() {
    const rows = await this.prisma.fiscalFieldProvenance.findMany({ orderBy: { field: 'asc' } });
    const optant = rows.find((r) => r.field === 'simplesOptant')?.evidence as { optant?: boolean } | null | undefined;
    const cred = await this.prisma.fiscalCredential.findFirst({ select: { taxDataConsent: true, taxDataConsentAt: true } });
    return {
      fields: rows.filter((r) => r.field !== 'simplesOptant').map((r) => ({ field: r.field, source: r.source, confidence: r.confidence, fetchedAt: r.fetchedAt, reference: r.reference })),
      simplesOptant: typeof optant?.optant === 'boolean' ? optant.optant : null,
      /** O que o Fixer consegue buscar sozinho neste ambiente. */
      sources: { receita: Boolean(this.integra?.enabled), prefeitura: Boolean(this.nfse?.enabled) },
      taxDataConsent: cred ? { enabled: cred.taxDataConsent, at: cred.taxDataConsentAt } : null,
    };
  }

  private async resetFor(orgId: string, reset: Exclude<ResetKind, 'NENHUM'>) {
    const cleared: string[] = [...MUNICIPAL_FIELDS];
    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.TenantFiscalSettingsUpdateInput = { municipalityIbge: null, issRate: null, municipalServiceCode: null, cnae: null, lc116Item: null };
      if (reset === 'EMPRESA') {
        data.taxRegime = null;
        cleared.push('taxRegime', 'simplesOptant', 'icmsSalePct', 'rbt12', 'stateTaxRegular');
        await tx.tenantTaxProfile.updateMany({ data: COMPANY_TAX_PROFILE_RESET });
      }
      await tx.tenantFiscalSettings.update({ where: { orgId }, data });
      await tx.fiscalFieldProvenance.deleteMany({ where: { field: { in: cleared } } });
    });
  }
}

type Apply = (field: AutofillField, currentValue: unknown, next: string | null, w: Omit<ProvenanceWrite, 'field'>) => Omit<FieldResult, 'source' | 'confidence'>;

/** Passo do Integra Contador que não trouxe dado. */
function integraStep(step: StepId, r: { status: string; detail?: string }, noData: string): StepResult {
  if (r.status === 'SEM_AUTORIZACAO') return { step, status: 'AGUARDANDO_CONSENTIMENTO', detail: 'A Receita ainda não reconhece a autorização da oficina para o Fixer.' };
  if (r.status === 'FALHOU') return { step, status: 'FALHOU', detail: r.detail ?? 'Não foi possível consultar a Receita agora.' };
  return { step, status: 'SEM_DADO', detail: r.detail ?? noData };
}

/**
 * R1 (spec §4): campo vazio ou de origem automática recebe o valor da fonte; valor digitado (ou anterior à proveniência,
 * que não se sabe de onde veio) só é comparado.
 */
export function decide(field: AutofillField, current: unknown, next: string | null, prov: Pick<FiscalFieldProvenance, 'source'> | undefined): Omit<FieldResult, 'source' | 'confidence'> {
  if (next === null) return { field, outcome: 'SEM_DADO', value: str(current) };
  if (sameValue(current, next)) return { field, outcome: 'IGUAL', value: next };
  if (current == null) return { field, outcome: 'PREENCHIDO', value: next };
  const manual = !prov || prov.source === 'MANUAL';
  return manual ? { field, outcome: 'CONFLITO', value: next, previous: str(current) } : { field, outcome: 'PREENCHIDO', value: next, previous: str(current) };
}
