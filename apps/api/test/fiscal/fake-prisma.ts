/**
 * Prisma em memória só com o que a sincronização fiscal usa. `$transaction` tem semântica de rollback
 * (snapshot restaurado se o callback lança), o que permite testar a atomicidade lote + NSU sem Postgres.
 * Não substitui um teste contra o banco real (pendente: sem Postgres local nesta fase).
 */
export interface Row {
  [key: string]: any;
}

export class FakePrisma {
  invoices = new Map<string, Row>();
  items: Row[] = [];
  maps: Row[] = [];
  parts: Row[] = [];
  state: Row | null = { id: 1, lastNsu: 0n, maxNsu: 0n, consecutiveFailures: 0, lastStatusCode: null, lastError: null, nextPollAt: new Date(0) };
  credential: Row | null = { id: 1, enabled: true, autoManifest: false };
  settings: Row | null = { id: 1, cnpj: '12ABC34501DE35', ufCode: 35 };
  /** Gancho para injetar falhas: chamado a cada `purchaseInvoice.create`. */
  onInvoiceCreate: ((data: Row) => void) | null = null;
  private seq = 0;

  purchaseInvoice = {
    findUnique: async ({ where }: { where: { accessKey?: string; id?: string } }) =>
      where.accessKey
        ? (this.invoices.get(where.accessKey) ?? null)
        : ([...this.invoices.values()].find((r) => r.id === where.id) ?? null),
    create: async ({ data }: { data: Row }) => {
      this.onInvoiceCreate?.(data);
      if (this.invoices.has(data.accessKey)) throw new Error('unique violation: accessKey');
      const row = {
        id: `inv${++this.seq}`,
        exportStatus: 'NOT_READY',
        needsReview: false,
        manifestAttempts: 0,
        manifestError: null,
        manifestNextAt: null,
        receivedAt: new Date(1_000 * this.seq),
        ...data,
      };
      this.invoices.set(data.accessKey, row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = [...this.invoices.values()].find((r) => r.id === where.id);
      if (!row) throw new Error('record not found');
      Object.assign(row, data);
      return row;
    },
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
      const row = [...this.invoices.values()].find((r) => r.id === where.id);
      if (!row) throw new Error('record not found');
      return row;
    },
    /** Entende só o filtro da ciência: status SUMMARY, tentativas < N e manifestNextAt vazio ou vencido. */
    findMany: async ({ where, take }: { where: Row; take?: number }) => {
      const rows = [...this.invoices.values()]
        .filter(
          (r) =>
            r.status === where.status &&
            r.manifestAttempts < where.manifestAttempts.lt &&
            (r.manifestNextAt === null || r.manifestNextAt <= where.OR[1].manifestNextAt.lte),
        )
        .sort((a, b) => a.receivedAt - b.receivedAt);
      return rows.slice(0, take);
    },
    updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Row }) => {
      const row = [...this.invoices.values()].find((r) => r.id === where.id && r.status === where.status);
      if (!row) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  };

  purchaseInvoiceItem = {
    findMany: async ({ where }: { where: { invoiceId: string } }) => this.items.filter((i) => i.invoiceId === where.invoiceId),
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = this.items.find((i) => i.id === where.id);
      if (!row) throw new Error('record not found');
      return Object.assign(row, data);
    },
    deleteMany: async ({ where }: { where: { invoiceId: string } }) => {
      const before = this.items.length;
      this.items = this.items.filter((i) => i.invoiceId !== where.invoiceId);
      return { count: before - this.items.length };
    },
    createMany: async ({ data }: { data: Row[] }) => {
      for (const d of data) {
        if (this.items.some((i) => i.invoiceId === d.invoiceId && i.itemNumber === d.itemNumber)) {
          throw new Error('unique violation: invoiceId,itemNumber');
        }
        this.items.push({ id: `it${++this.seq}`, resolution: 'UNRESOLVED', partId: null, unitFactor: '1', ...d });
      }
      return { count: data.length };
    },
  };

  supplierItemMap = {
    findMany: async ({ where }: { where: { supplierCnpj: string; supplierCode: { in: string[] } } }) =>
      this.maps.filter((m) => m.supplierCnpj === where.supplierCnpj && where.supplierCode.in.includes(m.supplierCode)),
    upsert: async ({ where, create, update }: { where: { supplierCnpj_supplierCode: Row }; create: Row; update: Row }) => {
      const key = where.supplierCnpj_supplierCode;
      const row = this.maps.find((m) => m.supplierCnpj === key.supplierCnpj && m.supplierCode === key.supplierCode);
      if (row) return Object.assign(row, update);
      const made = { id: `m${++this.seq}`, ...create };
      this.maps.push(made);
      return made;
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const rows = this.maps.filter((m) => m.supplierCnpj === where.supplierCnpj && m.supplierCode === where.supplierCode);
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    },
  };

  part = {
    findMany: async ({ where }: { where: { ean: { in: string[] } } }) => this.parts.filter((p) => where.ean.in.includes(p.ean)),
  };

  fiscalSyncState = {
    findUnique: async () => (this.state ? { ...this.state } : null),
    update: async ({ data }: { data: Row }) => Object.assign(this.state!, data),
    updateMany: async ({ where, data }: { where: { lastNsu?: { lte: bigint } }; data: Row }) => {
      if (!this.state || (where.lastNsu && !(this.state.lastNsu <= where.lastNsu.lte))) return { count: 0 };
      Object.assign(this.state, data);
      return { count: 1 };
    },
  };

  fiscalCredential = {
    findUnique: async () => (this.credential ? { ...this.credential } : null),
    update: async ({ data }: { data: Row }) => Object.assign(this.credential!, data),
  };

  tenantFiscalSettings = {
    findUnique: async () => (this.settings ? { ...this.settings } : null),
  };

  async $transaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    const snapshot = {
      invoices: new Map([...this.invoices].map(([k, v]) => [k, { ...v }])),
      items: this.items.map((i) => ({ ...i })),
      state: this.state && { ...this.state },
      credential: this.credential && { ...this.credential },
    };
    try {
      return await fn(this);
    } catch (err) {
      this.invoices = snapshot.invoices;
      this.items = snapshot.items;
      this.state = snapshot.state;
      this.credential = snapshot.credential;
      throw err;
    }
  }

  invoice(key: string): Row {
    return this.invoices.get(key)!;
  }
  itemsOf(key: string): Row[] {
    return this.items.filter((i) => i.invoiceId === this.invoices.get(key)?.id);
  }
}
