import { ClipboardList, FileText, Receipt, LayoutDashboard, Plus, UserPlus, Users, Bell, Settings, KeyRound, PackageSearch, UsersRound, type LucideIcon } from 'lucide-react';

// Fonte única da navegação: sidebar, tab bar mobile, paleta de comandos e atalhos leem daqui.
// Para criar uma nova seção: declare o link e coloque-o em um grupo de NAV_GROUPS (ele aparece na sidebar, na gaveta
// do celular, na paleta e no atalho "g").
export type NavLink = {
  id: string;
  href: string;
  label: string;
  icon: LucideIcon;
  /** Segunda tecla do atalho "g" + tecla (ex.: g o → Ordens). */
  goKey: string;
  match: 'exact' | 'prefix';
  /** Termos extras para a busca da paleta. */
  keywords: string[];
  /** false = fora da tab bar do celular (ela tem 5 vagas); continua no menu do desktop e na paleta. */
  mobile?: false;
};

export const NAV_LINKS: NavLink[] = [
  { id: 'painel', href: '/', label: 'Painel', icon: LayoutDashboard, goKey: 'p', match: 'exact', keywords: ['dashboard', 'inicio', 'resumo', 'home'] },
  { id: 'ordens', href: '/ordens', label: 'Ordens', icon: ClipboardList, goKey: 'o', match: 'prefix', keywords: ['os', 'servicos', 'ordens de servico'] },
  { id: 'pecas', href: '/pecas', label: 'Peças', icon: PackageSearch, goKey: 'e', match: 'prefix', mobile: false, keywords: ['catalogo', 'produtos', 'busca', 'cross', 'equivalente', 'compatibilidade', 'aplicacao', 'estoque', 'ean', 'gtin', 'codigo de barras', 'oem'] },
  { id: 'clientes', href: '/clientes', label: 'Clientes', icon: Users, goKey: 'c', match: 'prefix', keywords: ['cadastro', 'pessoas'] },
  { id: 'notas', href: '/notas', label: 'Notas', icon: FileText, goKey: 'f', match: 'prefix', mobile: false, keywords: ['nfe', 'nf-e', 'compras', 'fornecedor', 'xml', 'entrada', 'estoque', 'fiscal'] },
  { id: 'contas-a-pagar', href: '/contas-a-pagar', label: 'Contas a pagar', icon: Receipt, goKey: 'b', match: 'prefix', mobile: false, keywords: ['financeiro', 'boleto', 'vencimento', 'duplicata', 'parcela', 'pagamento', 'fornecedor'] },
];

export const TEAM_LINK: NavLink = {
  id: 'equipe',
  href: '/equipe',
  label: 'Equipe',
  icon: UsersRound,
  goKey: 't',
  match: 'prefix',
  mobile: false,
  keywords: ['funcionarios', 'pessoas', 'mecanicos', 'colaboradores', 'rh', 'vinculo', 'funcao', 'admissao', 'time', 'tecnicos'],
};

export const NOTIFICATIONS_LINK: NavLink = {
  id: 'notificacoes',
  href: '/notificacoes',
  label: 'Notificações',
  icon: Bell,
  goKey: 'n',
  match: 'prefix',
  keywords: ['alertas', 'avisos', 'inbox'],
};

export const SETTINGS_LINK: NavLink = {
  id: 'configuracoes',
  href: '/configuracoes',
  label: 'Cadastro da oficina',
  icon: Settings,
  goKey: 'a',
  match: 'prefix',
  keywords: ['configuracoes', 'ajustes', 'cadastro', 'empresa', 'cnpj', 'certificado', 'fiscal', 'oficina'],
};

export const ACCESS_LINK: NavLink = {
  id: 'acessos',
  href: '/configuracoes/acessos',
  label: 'Acessos',
  icon: KeyRound,
  goKey: 'u',
  match: 'prefix',
  keywords: ['usuarios', 'pessoas', 'equipe', 'papeis', 'permissoes', 'convidar', 'senha', 'admin', 'funcionarios'],
};

export type NavAction = { id: string; href: string; label: string; short: string; icon: LucideIcon; key?: string; keywords: string[] };

export type NavGroup = { id: string; label: string; items: NavLink[] };

/** Agrupamento da sidebar e da gaveta do celular. Cada grupo é recolhível; a ordem aqui é a ordem na tela. */
export const NAV_GROUPS: NavGroup[] = [
  { id: 'operacao', label: 'Operação', items: NAV_LINKS.filter((l) => ['painel', 'ordens', 'pecas', 'clientes'].includes(l.id)) },
  { id: 'financeiro', label: 'Financeiro', items: NAV_LINKS.filter((l) => ['contas-a-pagar', 'notas'].includes(l.id)) },
  { id: 'oficina', label: 'Oficina', items: [TEAM_LINK, NOTIFICATIONS_LINK, SETTINGS_LINK, ACCESS_LINK] },
];

/** Todos os destinos navegáveis, na ordem dos grupos (paleta, atalhos "g" e dica). */
export const ALL_LINKS: NavLink[] = NAV_GROUPS.flatMap((g) => g.items);

export const NAV_ACTIONS: NavAction[] = [
  { id: 'nova-os', href: '/ordens/nova', label: 'Nova ordem de serviço', short: 'Nova OS', icon: Plus, key: 'n', keywords: ['criar', 'abrir', 'placa', 'os'] },
  { id: 'nova-conta', href: '/contas-a-pagar?nova=1', label: 'Nova conta a pagar', short: 'Conta a pagar', icon: Receipt, keywords: ['pagar', 'boleto', 'despesa', 'financeiro', 'lancar'] },
  { id: 'novo-cliente', href: '/clientes/novo', label: 'Novo cliente', short: 'Cliente', icon: UserPlus, keywords: ['criar', 'cadastrar'] },
];

export function isActive(pathname: string, link: Pick<NavLink, 'href' | 'match'>): boolean {
  if (link.match === 'exact') return pathname === link.href;
  return pathname === link.href || pathname.startsWith(`${link.href}/`);
}

/** Item ativo: o destino mais específico que casa com a rota (/configuracoes/acessos vence /configuracoes). */
export function activeLinkId(pathname: string): string | null {
  const hits = ALL_LINKS.filter((l) => isActive(pathname, l));
  hits.sort((a, b) => b.href.length - a.href.length);
  return hits[0]?.id ?? null;
}

/** Remove acentos e caixa para a busca. */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}
