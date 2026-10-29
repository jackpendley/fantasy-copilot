// What a page shows while its data loads (each route's loading.tsx): the real title at once,
// then placeholder rows the same height as the page's own, so nothing jumps when it arrives.

import { PageHeader } from "@/components/fc/bits";
import { Skeleton } from "@/components/ui/skeleton";

export function PageSkeleton({
  title,
  rows = 8,
  rowHeight = 56,
}: {
  title: string;
  rows?: number;
  rowHeight?: number;
}) {
  return (
    <div aria-busy="true" aria-label={`Loading ${title}`} className="space-y-4">
      <PageHeader title={title} subtitle={<Skeleton className="mt-1 h-4 w-48" />} />
      <Skeleton className="h-8 w-full max-w-md" />
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-3" style={{ height: rowHeight }}>
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
            <Skeleton className="h-5 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}
