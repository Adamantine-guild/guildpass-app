"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface RangeResult {
  start: number;
  end: number;
  paddingTop: number;
  paddingBottom: number;
}

export function getRangeForOffset({
  total,
  viewportHeight,
  itemHeight,
  scrollTop,
  overscan,
}: {
  total: number;
  viewportHeight: number;
  itemHeight: number;
  scrollTop: number;
  overscan: number;
}): RangeResult {
  const firstVisible = Math.floor(scrollTop / itemHeight);
  const visibleCount = Math.ceil(viewportHeight / itemHeight);
  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(total, firstVisible + visibleCount + overscan);
  const paddingTop = start * itemHeight;
  const paddingBottom = Math.max(0, (total - end) * itemHeight);
  return { start, end, paddingTop, paddingBottom };
}

type VirtualListProps<T> = {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  estimatedItemHeight?: number;
  overscan?: number;
  className?: string;
};

/**
 * Lightweight windowing / virtualization that uses the window scroll position.
 * - No external deps
 * - Uses a fixed estimated item height (fast and predictable)
 */
export default function VirtualList<T>({
  items,
  renderItem,
  estimatedItemHeight = 88,
  overscan = 3,
  className,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState<number>(() =>
    typeof window !== "undefined" ? window.innerHeight : 800
  );
  const [scrollTop, setScrollTop] = useState(0);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const top = rect.top;
    const st = Math.max(0, -top);
    setScrollTop(st);
  }, []);

  useEffect(() => {
    const handleResize = () => setViewportHeight(window.innerHeight);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, [onScroll]);

  const range = useMemo(() =>
    getRangeForOffset({
      total: items.length,
      viewportHeight,
      itemHeight: estimatedItemHeight,
      scrollTop,
      overscan,
    }),
    [items.length, viewportHeight, estimatedItemHeight, scrollTop, overscan]
  );

  const windowItems = items.slice(range.start, range.end);

  // Preserve viewport when new items are prepended.
  const prevLenRef = useRef(items.length);
  const prevFirstIdRef = useRef((items[0] as any)?.id);
  useEffect(() => {
    const prevLen = prevLenRef.current;
    const prevFirstId = prevFirstIdRef.current;
    const newLen = items.length;
    const newFirstId = (items[0] as any)?.id;

    const addedCount = newLen - prevLen;
    const isPrepended = addedCount > 0 && newFirstId !== prevFirstId;
    if (isPrepended) {
      // If the user is near the top, scroll to top to reveal new items.
      const nearTop = typeof window !== "undefined" ? window.scrollY < 100 : true;
      if (nearTop) {
        window.scrollTo({ top: 0 });
      } else {
        // Otherwise, shift the scroll down by the added content height to preserve viewport.
        window.scrollBy(0, addedCount * estimatedItemHeight);
      }
    }

    prevLenRef.current = newLen;
    prevFirstIdRef.current = newFirstId;
  }, [items, estimatedItemHeight]);

  return (
    <div ref={containerRef} className={className}>
      <ul>
        <li style={{ height: range.paddingTop }} aria-hidden />
        {windowItems.map((item, i) => (
          <React.Fragment key={(item as any)?.id ?? range.start + i}>
            {renderItem(item, range.start + i)}
          </React.Fragment>
        ))}
        <li style={{ height: range.paddingBottom }} aria-hidden />
      </ul>
    </div>
  );
}
