"use client";

import { useCallback, useRef, useState } from "react";

export function usePendingWorkItems() {
  const activeIds = useRef(new Set<string>());
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());

  const beginOperation = useCallback((id: string) => {
    // Guard synchronously, including repeated clicks before React renders.
    if (activeIds.current.has(id)) return false;
    activeIds.current.add(id);
    setPendingIds(new Set(activeIds.current));
    return true;
  }, []);

  const endOperation = useCallback((id: string) => {
    activeIds.current.delete(id);
    setPendingIds(new Set(activeIds.current));
  }, []);

  const isOperationPending = useCallback((id: string) => activeIds.current.has(id), []);

  return { pendingIds, beginOperation, endOperation, isOperationPending };
}
