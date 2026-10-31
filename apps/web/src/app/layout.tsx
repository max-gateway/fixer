import type { Metadata } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import { getBranding } from '@/lib/branding';
import { THEME_SCRIPT } from '@/lib/theme';
import './globals.css';

// Branding vem de env em runtime: não pode ser pré-renderizado no build.
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const b = getBranding();
  return { title: b.displayName, icons: b.iconUrl ? { icon: b.iconUrl } : undefined };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const b = getBranding();
  // Cor crua do tenant; globals.css deriva dela as --brand-* de cada tema (claro/escuro).
  const theme = {
    '--tenant-primary': b.primaryColor,
    '--tenant-secondary': b.secondaryColor,
  } as CSSProperties;

  return (
    // suppressHydrationWarning: o script abaixo põe a classe `dark` antes do React hidratar.
    <html lang="pt-BR" style={theme} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <div aria-hidden className="bg-app-texture pointer-events-none fixed inset-x-0 top-0 -z-10 h-[26rem]" />
        {children}
      </body>
    </html>
  );
}
