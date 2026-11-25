import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-5" aria-busy>
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}
