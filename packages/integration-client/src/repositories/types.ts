// packages/integration-client/src/repositories/types.ts

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
  list(): Promise<Paginated<import('../types.js').Pass>>;
  /** Get a single pass by id */
  get(id: string): Promise<import('../types.js').Pass | undefined>;
}

export interface GuildRepository {
  list(): Promise<Paginated<import('../types.js').Guild>>;
  get(id: string): Promise<import('../types.js').Guild | undefined>;
}

export interface MemberRepository {
  list(): Promise<Paginated<import('../types.js').Member>>;
  get(id: string): Promise<import('../types.js').Member | undefined>;
}

export interface ActivityRepository {
  /** Return activity events – same shape as current mock fetchActivity */
  list(): Promise<import('../types.js').Activity[]>;
  /** Generate a mock activity for testing */
  generateMock(): Promise<import('../types.js').Activity>;
}
