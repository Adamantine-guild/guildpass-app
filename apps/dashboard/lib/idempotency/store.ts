import { mkdir, open, readFile, rm, unlink } from "node:fs/promises";
import { join } from "node:path";

import { query } from "../db";

export interface IdempotencyStore {
  hasSeen(eventId: string): Promise<boolean>;
  markSeen(eventId: string, ttlSeconds?: number): Promise<boolean>;
}

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

function expiryTimestamp(ttlSeconds: number): Date {
  return new Date(Date.now() + ttlSeconds * 1000);
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlSeconds: number = DEFAULT_TTL_SECONDS) {}

  async hasSeen(eventId: string): Promise<boolean> {
    this.pruneExpired();
    return this.seen.has(eventId);
  }

  async markSeen(eventId: string, ttlSeconds = this.ttlSeconds): Promise<boolean> {
    this.pruneExpired();
    if (this.seen.has(eventId)) {
      return false;
    }

    this.seen.set(eventId, expiryTimestamp(ttlSeconds).getTime());
    return true;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [eventId, expiresAt] of this.seen.entries()) {
      if (expiresAt <= now) {
        this.seen.delete(eventId);
      }
    }
  }
}

export class FileIdempotencyStore implements IdempotencyStore {
  private readonly processedDir: string;

  constructor(
    private readonly rootDir: string,
    private readonly ttlSeconds: number = DEFAULT_TTL_SECONDS,
  ) {
    this.processedDir = join(rootDir, "processed-webhooks");
  }

  async hasSeen(eventId: string): Promise<boolean> {
    await this.ensureStore();

    try {
      const marker = await readFile(this.markerPath(eventId), "utf8");
      const parsed = JSON.parse(marker) as { expiresAt: string };
      const expiresAt = new Date(parsed.expiresAt).getTime();

      if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
        await this.removeMarker(eventId);
        return false;
      }

      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  async markSeen(eventId: string, ttlSeconds = this.ttlSeconds): Promise<boolean> {
    await this.ensureStore();

    try {
      const marker = await open(this.markerPath(eventId), "wx");
      await marker.writeFile(
        JSON.stringify({ expiresAt: expiryTimestamp(ttlSeconds).toISOString() }),
        "utf8",
      );
      await marker.close();
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        const current = await this.readMarker(eventId);
        if (!current) {
          return this.markSeen(eventId, ttlSeconds);
        }

        if (current.expiresAt <= new Date().toISOString()) {
          await this.removeMarker(eventId);
          return this.markSeen(eventId, ttlSeconds);
        }

        return false;
      }
      throw error;
    }
  }

  private markerPath(eventId: string): string {
    return join(this.processedDir, encodeURIComponent(eventId));
  }

  private async ensureStore(): Promise<void> {
    await mkdir(this.processedDir, { recursive: true });
  }

  private async readMarker(eventId: string): Promise<{ expiresAt: string } | null> {
    try {
      const marker = await readFile(this.markerPath(eventId), "utf8");
      const parsed = JSON.parse(marker) as { expiresAt: string };
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  private async removeMarker(eventId: string): Promise<void> {
    try {
      await unlink(this.markerPath(eventId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}

export class DurableIdempotencyStore implements IdempotencyStore {
  constructor(private readonly ttlSeconds: number = DEFAULT_TTL_SECONDS) {}

  async hasSeen(eventId: string): Promise<boolean> {
    await this.pruneExpired();
    const result = await query("SELECT 1 FROM processed_events WHERE event_id = $1", [eventId]);
    return (result.rowCount ?? 0) > 0;
  }

  async markSeen(eventId: string, ttlSeconds = this.ttlSeconds): Promise<boolean> {
    await this.pruneExpired();
    const expiresAt = expiryTimestamp(ttlSeconds).toISOString();
    const result = await query(
      `INSERT INTO processed_events (event_id, expires_at) VALUES ($1, $2)
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId, expiresAt],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async pruneExpired(): Promise<void> {
    await query("DELETE FROM processed_events WHERE expires_at <= NOW()");
  }
}
