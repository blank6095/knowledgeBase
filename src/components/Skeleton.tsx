/** 骨架屏基元：表面底 + 微光扫过（.skeleton 定义于 globals.css） */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

/** 页面级加载骨架：与真实页头结构同形，避免内容加载后跳动 */
export function PageSkeleton({ rows = 3, rowClass = 'h-16' }: { rows?: number; rowClass?: string }) {
  return (
    <div className="fade-up space-y-3" role="status" aria-label="加载中">
      <Skeleton className="h-8 w-40" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={rowClass} />
      ))}
    </div>
  );
}
