/**
 * Contract tests for the mock repository adapters.
 *
 * Runs the shared contract test suites against the in-memory mock adapters
 * to verify they satisfy the expected repository behaviours.
 *
 * Future durable adapters can be tested the same way by importing the
 * contract suites and passing their own factory functions.
 */

import {
  passRepositoryContract,
  guildRepositoryContract,
  memberRepositoryContract,
  activityRepositoryContract,
} from "./contracts";
import {
  MockPassRepository,
  MockGuildRepository,
  MockMemberRepository,
  MockActivityRepository,
} from "../../lib/repositories/adapters/mock";

passRepositoryContract(() => new MockPassRepository());
guildRepositoryContract(() => new MockGuildRepository());
memberRepositoryContract(() => new MockMemberRepository());
activityRepositoryContract(() => new MockActivityRepository());
