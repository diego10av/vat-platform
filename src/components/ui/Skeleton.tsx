import type { CSSProperties } from 'react';

export function Skeleton({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} />;
}

// Deterministic-ish widths so server render == client render (no
// hydration mismatch) AND so we stay pure (React 19 / react-hooks/purity
// forbids Math.random during render). The small variation is just
// eye candy.
const SKELETON_WIDTHS = [88, 76, 92, 81, 85, 78, 90, 83];

export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          style={{ width: `${SKELETON_WIDTHS[i % SKELETON_WIDTHS.length]}%` }}
        />
      ))}
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <Skeleton className="h-3 flex-1" />
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-3 w-24" />
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="animate-fadeIn">
      <Skeleton className="h-5 w-48 mb-2" />
      <Skeleton className="h-3 w-80 mb-6" />
      <div className="grid grid-cols-4 gap-3 mb-5">
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
      </div>
      <div className="bg-surface border border-border rounded-lg p-4">
        <SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow />
      </div>
    </div>
  );
}
