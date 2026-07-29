import type { DeadLetterEntry, DeadLetterStore } from "./dispatch-types.js";

/**
 * In-memory dead-letter store for deliveries that exhausted all retry
 * attempts. Structured to match `DeadLetterStore` so it's a drop-in swap
 * for a persistent store (database table, queue, etc) later — nothing in
 * `dispatchWebhook` depends on this being in-memory.
 */
export class InMemoryDeadLetterStore implements DeadLetterStore {
  private entries: DeadLetterEntry[] = [];

  record(entry: DeadLetterEntry): void {
    this.entries.push(entry);
  }

  list(): DeadLetterEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }
}
