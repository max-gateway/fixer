/**
 * Permissões que as rotas exigem (`@RequirePermission`). Fonte única: o provisionamento grava estas linhas em `Permission`
 * (referência compartilhada) e dá todas ao papel Admin de cada organização. Ao criar uma rota com permissão nova, acrescente-a aqui.
 */
export const PERMISSIONS: readonly { key: string; label: string }[] = [
  { key: 'fiscal.manage', label: 'Configurar a importação fiscal (certificado, CNPJ, automações)' },
  { key: 'fiscal.verify', label: 'Confirmar dados fiscais (contador)' },
  { key: 'invoices.read', label: 'Ver notas de compra' },
  { key: 'invoices.reconcile', label: 'Conciliar e lançar notas de compra' },
  { key: 'pricing.read', label: 'Ver a precificação das notas de compra' },
  { key: 'pricing.write', label: 'Definir preços de venda, regras de preço e perfil tributário' },
  { key: 'payables.read', label: 'Ver contas a pagar' },
  { key: 'payables.manage', label: 'Lançar, editar e cancelar contas a pagar' },
  { key: 'payables.pay', label: 'Registrar pagamento de contas a pagar' },
  { key: 'learning.manage', label: 'Gerenciar o aprendizado de tempos' },
];

export const ADMIN_ROLE = 'Admin';
