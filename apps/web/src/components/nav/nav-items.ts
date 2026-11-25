import { ClipboardList, FileText, LayoutDashboard, Plus, UserPlus, Users, Bell, type LucideIcon } from 'lucide-react';

// Fonte única da navegação: header, tab bar mobile, paleta de comandos e atalhos leem daqui.
// Para criar uma nova seção basta adicionar um item.
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
  { id: 'clientes', href: '/clientes', label: 'Clientes', icon: Users, goKey: 'c', match: 'prefix', keywords: ['cadastro', 'pessoas'] },
  { id: 'notas', href: '/notas', label: 'Notas', icon: FileText, goKey: 'f', match: 'prefix', mobile: false, keywords: ['nfe', 'nf-e', 'compras', 'fornecedor', 'xml', 'entrada', 'estoque', 'fiscal'] },
];

export const NOTIFICATIONS_LINK: NavLink = {
  id: 'notificacoes',
  href: '/notificacoes',
  label: 'Notificações',
  icon: Bell,
  goKey: 'n',
  match: 'prefix',
  keywords: ['alertas', 'avisos', 'inbox'],
};

export type NavAction = { id: string; href: string; label: string; short: string; icon: LucideIcon; key?: string; keywords: string[] };

export const NAV_ACTIONS: NavAction[] = [
  { id: 'nova-os', href: '/ordens/nova', label: 'Nova ordem de serviço', short: 'Nova OS', icon: Plus, key: 'n', keywords: ['criar', 'abrir', 'placa', 'os'] },
  { id: 'novo-cliente', href: '/clientes/novo', label: 'Novo cliente', short: 'Cliente', icon: UserPlus, keywords: ['criar', 'cadastrar'] },
];

export function isActive(pathname: string, link: Pick<NavLink, 'href' | 'match'>): boolean {
  if (link.match === 'exact') return pathname === link.href;
  return pathname === link.href || pathname.startsWith(`${link.href}/`);
}

/** Remove acentos e caixa para a busca. */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}
