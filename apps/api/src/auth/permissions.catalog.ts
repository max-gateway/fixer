/**
 * Permissões que as rotas exigem (`@RequirePermission`). Fonte única: o provisionamento grava estas linhas em `Permission`
 * (referência compartilhada) e dá todas ao papel Admin de cada organização. Ao criar uma rota com permissão nova, acrescente-a aqui.
 * `group` só organiza a tela de papéis (Configurações → Acessos); `risk: 'high'` destaca permissões sensíveis.
 */
export interface PermissionDef {
  key: string;
  label: string;
  group: PermissionGroup;
  risk?: 'high';
}

export type PermissionGroup = 'fiscal' | 'invoices' | 'pricing' | 'payables' | 'learning' | 'access' | 'catalog' | 'workforce';

/** Ordem e nome dos grupos na tela. */
export const PERMISSION_GROUPS: readonly { key: PermissionGroup; label: string; description: string }[] = [
  { key: 'access', label: 'Acessos', description: 'Pessoas, papéis e convites da oficina' },
  { key: 'fiscal', label: 'Fiscal', description: 'Certificado digital, CNPJ e automações da SEFAZ' },
  { key: 'invoices', label: 'Notas de compra', description: 'Notas recebidas dos fornecedores' },
  { key: 'pricing', label: 'Precificação', description: 'Preço de venda, regras e perfil tributário' },
  { key: 'payables', label: 'Contas a pagar', description: 'Parcelas, lançamentos e pagamentos' },
  { key: 'learning', label: 'Aprendizado', description: 'Tempos de serviço aprendidos com as OS' },
  { key: 'catalog', label: 'Catálogo de peças', description: 'Vínculo das peças da oficina com o catálogo da plataforma' },
  { key: 'workforce', label: 'Equipe', description: 'Cadastro de pessoas, vínculos e funções da oficina' },
];

export const PERMISSIONS: readonly PermissionDef[] = [
  { key: 'access.read', label: 'Ver pessoas, papéis e o histórico de acessos', group: 'access' },
  { key: 'access.manage', label: 'Convidar pessoas, editar papéis e permissões', group: 'access', risk: 'high' },
  { key: 'fiscal.manage', label: 'Configurar a importação fiscal (certificado, CNPJ, automações)', group: 'fiscal', risk: 'high' },
  { key: 'fiscal.verify', label: 'Confirmar dados fiscais (contador)', group: 'fiscal' },
  { key: 'invoices.read', label: 'Ver notas de compra', group: 'invoices' },
  { key: 'invoices.reconcile', label: 'Conciliar e lançar notas de compra', group: 'invoices' },
  { key: 'pricing.read', label: 'Ver a precificação das notas de compra', group: 'pricing' },
  { key: 'pricing.write', label: 'Definir preços de venda, regras de preço e perfil tributário', group: 'pricing' },
  { key: 'payables.read', label: 'Ver contas a pagar', group: 'payables' },
  { key: 'payables.manage', label: 'Lançar, editar e cancelar contas a pagar', group: 'payables' },
  { key: 'payables.pay', label: 'Registrar pagamento de contas a pagar', group: 'payables', risk: 'high' },
  { key: 'learning.manage', label: 'Gerenciar o aprendizado de tempos', group: 'learning' },
  { key: 'catalog.link', label: 'Vincular e desvincular peças do catálogo da plataforma', group: 'catalog' },
  { key: 'workforce.read', label: 'Ver a equipe (pessoas, vínculos e funções)', group: 'workforce' },
  { key: 'workforce.manage', label: 'Cadastrar pessoas, admitir, mudar de função e desligar', group: 'workforce', risk: 'high' },
];

export const ADMIN_ROLE = 'Admin';

/** Permissão que administra os próprios acessos: a regra de "sempre sobra um administrador" gira em torno dela. */
export const ACCESS_MANAGE = 'access.manage';
