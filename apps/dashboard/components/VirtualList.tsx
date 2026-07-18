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

  const range = useMemo(
    () =>
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

  // measured heights per absolute index
  const heightsRef = useRef<Map<number, number>>(new Map());
  const [, forceRerender] = useState(0);

  const measure = useCallback((el: HTMLElement | null, index: number) => {
    if (!el) return;
    const h = el.offsetHeight;
    const prev = heightsRef.current.get(index);
    if (prev !== h) {
      heightsRef.current.set(index, h);
      forceRerender((v) => v + 1);
    }
  }, []);

  const computePaddings = useCallback(
    (start: number, end: number) => {
      let paddingTop = 0;
      let paddingBottom = 0;
      for (let i = 0; i < start; i++) {
        const h = heightsRef.current.get(i);
        paddingTop += h ?? estimatedItemHeight;
      }
      for (let i = end; i < items.length; i++) {
        const h = heightsRef.current.get(i);
        paddingBottom += h ?? estimatedItemHeight;
      }
      return { paddingTop, paddingBottom };
    },
    [estimatedItemHeight, items.length]
  );

  const { paddingTop, paddingBottom } = computePaddings(range.start, range.end);

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
      // Compute added height from measured heights when available.
      let addedHeight = 0;
      for (let i = 0; i < addedCount; i++) {
        const h = heightsRef.current.get(i);
        addedHeight += h ?? estimatedItemHeight;
      }
      const nearTop = typeof window !== "undefined" ? window.scrollY < 100 : true;
      if (nearTop) {
        window.scrollTo({ top: 0 });
      } else {
        window.scrollBy(0, addedHeight);
      }
    }

    prevLenRef.current = newLen;
    prevFirstIdRef.current = newFirstId;
  }, [items, estimatedItemHeight]);

  return (
    <div ref={containerRef} className={className}>
      <ul>
        <li style={{ height: paddingTop }} aria-hidden />
        {windowItems.map((item, i) => {
          const absIndex = range.start + i;
          const key = (item as any)?.id ?? absIndex;
          return (
            <li
              key={key}
              ref={(el) => measure(el as HTMLElement | null, absIndex)}
              className={undefined}
            >
              {renderItem(item, absIndex)}
            </li>
          );
        })}
        <li style={{ height: paddingBottom }} aria-hidden />
      </ul>
    </div>
  );
}
