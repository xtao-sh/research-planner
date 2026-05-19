import React from 'react';

/** A row of skeleton placeholders for a single task/note line. */
export function SkeletonRow() {
  return (
    <div className="rd-skeleton-row" aria-hidden="true">
      <span className="rd-skeleton rd-skeleton-pill" />
      <span className="rd-skeleton rd-skeleton-title" />
      <span className="rd-skeleton rd-skeleton-meta" />
    </div>
  );
}

/** A grid of skeleton rows for any list-style surface. Default = 4 rows. */
export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        // eslint-disable-next-line react/no-array-index-key -- placeholder skeletons; index IS the slot identity
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

/** A card skeleton — title line + 2 sub-lines. */
export function SkeletonCard() {
  return (
    <div className="rd-skeleton-card" aria-hidden="true">
      <div className="rd-skeleton rd-skeleton-line" style={{ width: '60%' }} />
      <div className="rd-skeleton rd-skeleton-line" style={{ width: '90%' }} />
      <div className="rd-skeleton rd-skeleton-line" style={{ width: '40%' }} />
    </div>
  );
}
