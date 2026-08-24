// packages/integration-client/src/repositories/types.ts

import type { Activity, Guild, Member, Pass } from "../types.js";

/**
 * Generic pagination result.
 */
export interface Paginated<T> {
  items: T[];
  total: number;
  /** Zero‑based index of the first item in this page */
  offset: number;
  /** Number of items per page */
  limit: number;
}

// Base repository signatures for each entity.
export interface PassRepository {
  /** List passes – pagination can be added later */
  list(): Promise<Paginated<Pass>>;
  /** Get a single pass by id */
  get(id: string): Promise<Pass | undefined>;
}

export interface GuildRepository {
  list(): Promise<Paginated<Guild>>;
  get(id: string): Promise<Guild | undefined>;
}

export interface MemberRepository {
  list(): Promise<Paginated<Member>>;
  get(id: string): Promise<Member | undefined>;
}

export interface ActivityRepository {
  /** Return activity events – same shape as current mock fetchActivity */
  list(): Promise<Paginated<Activity>>;
  /** Generate a mock activity for testing */
  generateMock(): Promise<Activity>;
}
