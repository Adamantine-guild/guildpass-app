import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ============================================================================
// 1. Define the mock implementations
// ============================================================================
const mockRequireSessionAndPermission = mock.fn(async () => undefined as any);
const mockGetActiveGuildId = mock.fn(() => undefined as any);
const mockGetGuildRepository = mock.fn(() => undefined as any);
const mockRecordDashboardActivity = mock.fn(async () => undefined as any);

const mockHandleApiError = mock.fn(async (cb: () => any) => {
  try {
    const result = await cb();
    return new Response(JSON.stringify(result), { status: 200 });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

const mockApiValidationError = mock.fn((message, errors) => {
  return new Response(JSON.stringify({ message, errors }), { status: 400 });
});

// ============================================================================
// 2. Register the module mocks (DO NOT mock the route.ts file itself)
// ⚠️ ACTION REQUIRED: Update these paths to point to your actual utility files!
// ============================================================================

// Example: Point this to wherever your auth/session utils live
mock.module('../app/lib/auth', {
  namedExports: {
    requireSessionAndPermission: mockRequireSessionAndPermission,
    getActiveGuildId: mockGetActiveGuildId,
  }
});

// Example: Point this to wherever your DB repositories live
mock.module('../app/lib/repositories', {
  namedExports: {
    getGuildRepository: mockGetGuildRepository,
    recordDashboardActivity: mockRecordDashboardActivity,
  }
});

// Example: Point this to wherever your API error handlers live
mock.module('../app/lib/api-utils', {
  namedExports: {
    handleApiError: mockHandleApiError,
    apiValidationError: mockApiValidationError,
  }
});

// ============================================================================
// 3. Test Suite
// ============================================================================
describe('POST /api/guilds', () => {
  beforeEach(() => {
    // Reset call counts and implementations before each test
    mockRequireSessionAndPermission.mock.resetCalls();
    mockGetActiveGuildId.mock.resetCalls();
    mockGetGuildRepository.mock.resetCalls();
    mockRecordDashboardActivity.mock.resetCalls();
    mockHandleApiError.mock.resetCalls();
    mockApiValidationError.mock.resetCalls();
  });

  afterEach(() => {
    mock.restoreAll();
  });

  const createRequest = (body: any) => {
    return new Request('http://localhost/api/guilds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  };

  it('should return the guard response if session/permission is invalid', async () => {
    // Arrange
    // ⚠️ DYNAMIC IMPORT: Load the route handler AFTER mocks are registered
    const { POST } = await import('../app/api/guilds/route');

    const unauthorizedResponse = new Response('Forbidden', { status: 403 });
    mockRequireSessionAndPermission.mock.mockImplementationOnce(async () => ({
      ok: false,
      response: unauthorizedResponse,
    }));

    const req = createRequest({ name: 'Test Guild' });

    // Act
    const res = await POST(req);

    // Assert
    assert.strictEqual(res, unauthorizedResponse);
    assert.strictEqual(mockHandleApiError.mock.calls.length, 0, 'Should not proceed to handleApiError');
  });

  it('should return a validation error if payload is missing required fields (name)', async () => {
    // Arrange
    const { POST } = await import('../app/api/guilds/route');

    mockRequireSessionAndPermission.mock.mockImplementationOnce(async () => ({
      ok: true,
      session: { userId: 'user-1', name: 'Alice' },
    }));

    // Missing 'name' payload
    const req = createRequest({ description: 'A nice guild', memberCount: 10 });

    // Act
    const res = await POST(req);
    const data = await res.json();

    // Assert
    assert.strictEqual(res.status, 400);
    assert.strictEqual(data.message, 'Invalid guild payload');
    assert.ok(data.errors.name, 'Should contain a validation error for the "name" field');
    assert.strictEqual(mockGetGuildRepository.mock.calls.length, 0, 'Repository should not be called');
  });

  it('should return a validation error if memberCount is invalid (negative number)', async () => {
    // Arrange
    const { POST } = await import('../app/api/guilds/route');

    mockRequireSessionAndPermission.mock.mockImplementationOnce(async () => ({
      ok: true,
      session: { userId: 'user-1', name: 'Alice' },
    }));

    // Invalid memberCount payload
    const req = createRequest({ name: 'Valid Name', description: '', memberCount: -5 });

    // Act
    const res = await POST(req);
    const data = await res.json();

    // Assert
    assert.strictEqual(res.status, 400);
    assert.ok(data.errors.memberCount, 'Should contain a validation error for the "memberCount" field');
  });

  it('should successfully create a guild and record activity with valid payload', async () => {
    // Arrange
    const { POST } = await import('../app/api/guilds/route');
    
    const mockSession = { userId: 'user-123', name: 'Test User' };
    mockRequireSessionAndPermission.mock.mockImplementationOnce(async () => ({
      ok: true,
      session: mockSession,
    }));

    const mockCreate = mock.fn(async () => ({
      id: 'guild-999',
      name: 'Adamantine Guild',
    }));

    mockGetGuildRepository.mock.mockImplementationOnce(() => ({
      create: mockCreate,
    }));

    const validPayload = {
      name: '  Adamantine Guild  ', // Testing if trim() works via schema
      description: 'A place for builders',
      memberCount: 50,
      passCount: 0,
    };

    const req = createRequest(validPayload);

    // Act
    const res = await POST(req);
    const data = await res.json();

    // Assert
    // 1. Verify Repository was called with validated (and trimmed) data
    assert.strictEqual(mockGetGuildRepository.mock.calls.length, 1);
    assert.strictEqual(mockCreate.mock.calls.length, 1);
    
    const createPayload = (mockCreate.mock.calls.at(0) as { arguments?: unknown[] } | undefined)?.arguments?.[0] as {
      description?: string;
      memberCount?: number;
      name?: string;
    } | undefined;
    assert.ok(createPayload, 'Expected repository create to receive a payload');
    const { description, memberCount, name } = createPayload;
    assert.strictEqual(name, 'Adamantine Guild'); // Was trimmed
    assert.strictEqual(description, 'A place for builders');
    assert.strictEqual(memberCount, 50);

    // 2. Verify Activity was recorded correctly
    assert.strictEqual(mockRecordDashboardActivity.mock.calls.length, 1);
    
    const activityArgs = (mockRecordDashboardActivity.mock.calls.at(0) as { arguments?: unknown[] } | undefined)?.arguments?.[0] as {
      type: string;
      entity: { type: string; id: string; name: string };
      actor: { id: string; name: string };
    } | undefined;
    assert.ok(activityArgs, 'Expected dashboard activity to be recorded');
    assert.deepEqual(activityArgs, {
      type: 'guild.created',
      entity: { type: 'guild', id: 'guild-999', name: 'Adamantine Guild' },
      actor: { id: mockSession.userId, name: mockSession.name },
    });

    // 3. Verify Response
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.id, 'guild-999');
  });
});