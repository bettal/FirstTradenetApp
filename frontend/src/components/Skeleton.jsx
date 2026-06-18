export default function Skeleton({ width, height = '1rem', borderRadius = 'var(--radius-sm)', style = {} }) {
  return (
    <div
      className="skeleton"
      style={{ width: width || '100%', height, borderRadius, ...style }}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="glass-card" style={{ padding: '1.5rem' }}>
      <Skeleton width="40%" height="1.25rem" style={{ marginBottom: '1rem' }} />
      <Skeleton width="60%" height="2rem" style={{ marginBottom: '0.75rem' }} />
      <Skeleton width="30%" height="0.875rem" style={{ marginBottom: '1rem' }} />
      <Skeleton height="0.75rem" style={{ marginTop: '1rem' }} />
    </div>
  );
}
