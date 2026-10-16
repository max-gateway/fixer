import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-5" aria-busy>
      <div className="space-y-2">
        <Skeleton className="h-8 w-60" />
        <Skeleton className="h-7 w-96 max-w-full rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[68px] rounded-xl" />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="space-y-3">
          <Skeleton className="h-11" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
        <Skeleton className="hidden h-80 rounded-xl lg:block" />
      </div>
    </div>
  );
}
