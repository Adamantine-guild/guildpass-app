/**
 * Repository factory: selects and instantiates repositories based on storage mode.
 * This is the single point of configuration for all data persistence.
 */

import type { IRepositoryFactory, IPassRepository, IGuildRepository, IMemberRepository, IActivityRepository } from "./types";
import { MockPassRepository, MockGuildRepository, MockMemberRepository, MockActivityRepository } from "./adapters/mock";
import { DurablePassRepository, DurableGuildRepository, DurableMemberRepository, DurableActivityRepository } from "./adapters/durable";
import { getStorageMode, getStorageConfig } from "../env";

/**
 * Singleton instances for mock repositories (reused per process).
 */
let mockPassRepo: IPassRepository | null = null;
let mockGuildRepo: IGuildRepository | null = null;
let mockMemberRepo: IMemberRepository | null = null;
let mockActivityRepo: IActivityRepository | null = null;

/**
 * Singleton instances for durable repositories (reused per process).
 */
let durablePassRepo: IPassRepository | null = null;
let durableGuildRepo: IGuildRepository | null = null;
let durableMemberRepo: IMemberRepository | null = null;
let durableActivityRepo: IActivityRepository | null = null;

/**
 * Creates or returns a cached repository factory based on storage mode.
 */
export function getRepositoryFactory(): IRepositoryFactory {
  const mode = getStorageMode();

  if (mode === "mock") {
    return {
      passRepository() {
        if (!mockPassRepo) mockPassRepo = new MockPassRepository();
        return mockPassRepo;
      },
      guildRepository() {
        if (!mockGuildRepo) mockGuildRepo = new MockGuildRepository();
        return mockGuildRepo;
      },
      memberRepository() {
        if (!mockMemberRepo) mockMemberRepo = new MockMemberRepository();
        return mockMemberRepo;
      },
      activityRepository() {
        if (!mockActivityRepo) mockActivityRepo = new MockActivityRepository();
        return mockActivityRepo as IActivityRepository;
      },
    };
  }

  if (mode === "durable") {
    const config = getStorageConfig();
    const connectionString = config.connectionString;

    return {
      passRepository() {
        if (!durablePassRepo) durablePassRepo = new DurablePassRepository(connectionString);
        return durablePassRepo;
      },
      guildRepository() {
        if (!durableGuildRepo) durableGuildRepo = new DurableGuildRepository(connectionString);
        return durableGuildRepo;
      },
      memberRepository() {
        if (!durableMemberRepo) durableMemberRepo = new DurableMemberRepository(connectionString);
        return durableMemberRepo;
      },
      activityRepository() {
        if (!durableActivityRepo) durableActivityRepo = new DurableActivityRepository(connectionString);
        return durableActivityRepo;
      },
    };
  }

  throw new Error(`Unknown storage mode: ${mode}`);
}

/**
 * Convenience function: get a specific repository directly.
 */
export function getPassRepository(): IPassRepository {
  return getRepositoryFactory().passRepository();
}

export function getGuildRepository(): IGuildRepository {
  return getRepositoryFactory().guildRepository();
}

export function getMemberRepository(): IMemberRepository {
  return getRepositoryFactory().memberRepository();
}

export function getActivityRepository(): IActivityRepository {
  return getRepositoryFactory().activityRepository();
}

/**
 * Clear cached repositories (useful for testing).
 */
export function clearRepositories(): void {
  mockPassRepo = null;
  mockGuildRepo = null;
  mockMemberRepo = null;
  mockActivityRepo = null;
  durablePassRepo = null;
  durableGuildRepo = null;
  durableMemberRepo = null;
  durableActivityRepo = null;
}
