import type { Metadata } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import { getBranding } from '@/lib/branding';
import './globals.css';

// Branding vem de env em runtime: não pode ser pré-renderizado no build.
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getBranding().displayName };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const b = getBranding();
  const theme = {
    '--brand-primary': b.primaryColor,
    '--brand-secondary': b.secondaryColor,
  } as CSSProperties;

  return (
    <html lang="pt-BR" style={theme}>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
