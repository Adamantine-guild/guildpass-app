import test from "node:test";
import assert from "node:assert";
import { IntegrationClient } from "../src/client.ts";

test("ContractClient - transport inheritance and call", async () => {
  let callOptions: any;
  const mockFetch = async (url: string, options: any) => {
    callOptions = options;
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: JSON.parse(options.body).id,
      result: "0x123"
    }));
  };

  const client = new IntegrationClient({
    baseUrl: "http://api",
    transport: {
      fetch: mockFetch as any,
      timeout: 5000
    }
  });

  const contract = client.getContractClient("http://rpc");
  const result = await contract.call("eth_blockNumber", []);

  assert.strictEqual(result, "0x123");
  assert.strictEqual(callOptions.method, "POST");
});

test("ContractClient - retry on transient RPC errors (HTTP 500)", async () => {
  let attempts = 0;
  const mockFetch = async () => {
    attempts++;
    if (attempts < 2) {
      return new Response("Error", { status: 503 });
    }
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: "ok"
    }));
  };

  const client = new IntegrationClient({
    baseUrl: "http://api",
    transport: {
      fetch: mockFetch as any,
      retry: { maxAttempts: 2, delay: 10 }
    }
  });

  const contract = client.getContractClient("http://rpc");
  const result = await contract.call("test", []);
  assert.strictEqual(result, "ok");
  assert.strictEqual(attempts, 2);
});

test("ContractClient - retry on transient JSON-RPC error", async () => {
  let attempts = 0;
  const mockFetch = async () => {
    attempts++;
    if (attempts < 2) {
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32005, message: "rate limit exceeded" }
      }), { status: 200 }); // note: HTTP 200, but RPC error
    }
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: "success"
    }));
  };

  const client = new IntegrationClient({
    baseUrl: "http://api",
    transport: {
      fetch: mockFetch as any
    }
  });

  // Since we use the module's default config for now, it should retry.
  const contract = client.getContractClient("http://rpc");
  const result = await contract.call("test", []);
  
  assert.strictEqual(result, "success");
  assert.strictEqual(attempts, 2);
});

test("ContractClient - no retry on permanent JSON-RPC error", async () => {
  let attempts = 0;
  const mockFetch = async () => {
    attempts++;
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: 3, message: "execution reverted" }
    }), { status: 200 });
  };

  const client = new IntegrationClient({
    baseUrl: "http://api",
    transport: {
      fetch: mockFetch as any
    }
  });

  const contract = client.getContractClient("http://rpc");
  
  try {
    await contract.call("test", []);
    assert.fail("Should have thrown");
  } catch (err: any) {
    assert.match(err.message, /RPC_ERROR:3 execution reverted/);
  }
  
  assert.strictEqual(attempts, 1);
});
