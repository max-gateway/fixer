import { Skeleton } from '@/components/ui/skeleton';

// Só aparece na primeira entrada; trocas de período mantêm o quadro (ver dashboard-view.tsx).
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy>
      <Skeleton className="h-8 w-56" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[460px] rounded-xl" />
    </div>
  );
}
