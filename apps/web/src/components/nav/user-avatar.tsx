import { cn } from 'cn';

export type NavUser = { name: string; email?: string | null };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0]!;
  const last = parts.length > 1 ? parts[parts.length - 1]![0]! : '';
  return (first + last).toUpperCase();
}

/** Matiz estável a partir do nome: cada pessoa ganha sempre a mesma cor. */
function hue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.codePointAt(0)!) % 360;
  return h;
}

/** Avatar com iniciais sobre gradiente gerado pelo nome (sem depender de foto). */
export function UserAvatar({ name, className }: { name: string; className?: string }) {
  const h = hue(name);
  return (
    <span
      aria-hidden
      style={{ backgroundImage: `linear-gradient(135deg, oklch(0.74 0.14 ${h}), oklch(0.5 0.16 ${(h + 45) % 360}))` }}
      className={cn(
        'relative inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold tracking-wide text-white select-none',
        'shadow-[inset_0_1px_0_rgb(255_255_255/0.35),inset_0_-6px_10px_rgb(0_0_0/0.15)] [text-shadow:0_1px_2px_rgb(0_0_0/0.3)]',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
