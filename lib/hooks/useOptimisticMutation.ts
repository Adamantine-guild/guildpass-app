"use client";

import { useState, useCallback } from "react";

interface OptimisticMutationOptions<T, D> {
  mutationFn: (variables: D) => Promise<T>;
  onOptimisticUpdate: (variables: D) => void;
  onRollback: (error: Error, variables: D) => void;
  onSuccess?: (data: T, variables: D) => void;
  onError?: (error: Error, variables: D) => void;
}

export function useOptimisticMutation<T, D>({
  mutationFn,
  onOptimisticUpdate,
  onRollback,
  onSuccess,
  onError,
}: OptimisticMutationOptions<T, D>) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutate = useCallback(
    async (variables: D) => {
      setIsPending(true);
      setError(null);

      // Perform optimistic update
      try {
        onOptimisticUpdate(variables);
      } catch (err) {
        console.error("Optimistic update failed:", err);
      }

      try {
        const result = await mutationFn(variables);
        setIsPending(false);
        if (onSuccess) {
          onSuccess(result, variables);
        }
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Mutation failed");
        setIsPending(false);
        setError(error);

        // Rollback on failure
        try {
          onRollback(error, variables);
        } catch (rollbackErr) {
          console.error("Rollback failed:", rollbackErr);
        }

        if (onError) {
          onError(error, variables);
        }
        throw error;
      }
    },
    [mutationFn, onOptimisticUpdate, onRollback, onSuccess, onError]
  );

  return {
    mutate,
    isPending,
    error,
    reset: () => setError(null),
  };
}
