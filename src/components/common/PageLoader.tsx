import { Skeleton } from '@/components/ui/skeleton'

/** Shown while a lazily-loaded route chunk is being fetched. */
export function PageLoader() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading view">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  )
}
