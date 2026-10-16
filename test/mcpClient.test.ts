import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { StreamableHttpMcpClient, parseSseJson } from "../src/mcp/client.js";
import { McpProtocolError, McpRateLimitError, McpTransportError } from "../src/errors.js";
import { FakeChainMcpServer } from "./helpers/fakeMcp.js";

const ENDPOINT = "https://mcp.example.test/mcp";

describe("parseSseJson", () => {
  it("extracts a JSON payload from a single SSE frame", () => {
    const payloads = parseSseJson('event: message\ndata: {"jsonrpc":"2.0","id":1}\n\n');
    assert.deepEqual(payloads, [{ jsonrpc: "2.0", id: 1 }]);
  });

  it("extracts multiple frames", () => {
    const payloads = parseSseJson('data: {"a":1}\n\ndata: {"b":2}\n\n');
    assert.deepEqual(payloads, [{ a: 1 }, { b: 2 }]);
  });

  it("joins multi-line data and ignores non-JSON frames", () => {
    const payloads = parseSseJson('data: {"a":\ndata: 1}\n\ndata: keep-alive\n\n');
    assert.deepEqual(payloads, [{ a: 1 }]);
  });

  it("returns nothing for an empty body", () => {
    assert.deepEqual(parseSseJson(""), []);
  });
});

describe("StreamableHttpMcpClient handshake", () => {
  it("initializes, captures the session id, notifies, and lists tools", async () => {
    const server = new FakeChainMcpServer({ handlers: { get_chain_info: () => ({ data: {} }) } });
    const client = new StreamableHttpMcpClient({ endpoint: ENDPOINT, fetchImpl: server.fetch });

    const info = await client.initialize();
    assert.equal(info.protocolVersion, "2024-11-05");
    assert.equal(info.serverInfo?.name, "pharos-mcp-server");
    assert.equal(client.currentSessionId, "fake-session-0001");

    const tools = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ["get_chain_info"],
    );

    const methods = server.requests.map((request) => request.rpcMethod);
    assert.deepEqual(methods, ["initialize", "notifications/initialized", "tools/list"]);

    // The initialize request must not carry a session header; later requests must.
    assert.equal(server.requests[0]?.headers["mcp-session-id"], undefined);
    assert.equal(server.requests[1]?.headers["mcp-session-id"], "fake-session-0001");
    assert.equal(server.requests[2]?.headers["mcp-session-id"], "fake-session-0001");
  });

  it("is idempotent: initialize only happens once", async () => {
    const server = new FakeChainMcpServer({ handlers: { get_chain_info: () => ({ data: {} }) } });
    const client = new StreamableHttpMcpClient({ endpoint: ENDPOINT, fetchImpl: server.fetch });
    await client.initialize();
    await client.initialize();
    assert.equal(server.requests.filter((request) => request.rpcMethod === "initialize").length, 1);
  });
});

describe("StreamableHttpMcpClient error handling", () => {
  it("raises McpProtocolError when the server returns no payload", async () => {
    const client = new StreamableHttpMcpClient({
      endpoint: ENDPOINT,
      fetchImpl: async () => new Response("", { status: 200, headers: { "content-type": "application/json" } }),
    });
    await assert.rejects(() => client.initialize(), (error: unknown) => error instanceof McpProtocolError);
  });

  it("raises McpProtocolError for a JSON-RPC error envelope", async () => {
    const client = new StreamableHttpMcpClient({
      endpoint: ENDPOINT,
      fetchImpl: async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    await assert.rejects(
      () => client.initialize(),
      (error: unknown) => error instanceof McpProtocolError && error.message.includes("no usable server information"),
    );
  });

  it("retries HTTP 429 and succeeds within the retry budget", async () => {
    let rateLimitedCount = 0;
    const server = new FakeChainMcpServer({ handlers: { get_chain_info: () => ({ data: { ok: true } }) } });
    const client = new StreamableHttpMcpClient({
      endpoint: ENDPOINT,
      maxRetries: 3,
      fetchImpl: async (input, init) => {
        // Rate-limit the very first HTTP request only; the retry must succeed.
        if (rateLimitedCount === 0) {
          rateLimitedCount += 1;
          return new Response("slow down", { status: 429, headers: { "retry-after": "0" } });
        }
        return server.fetch(input, init);
      },
    });

    const result = await client.callTool("get_chain_info");
    assert.equal(rateLimitedCount, 1, "exactly one rate-limited response should have been retried");
    assert.equal(result.isError, undefined);

    // The retried request carried the same RPC method and completed the handshake.
    assert.equal(server.requests[0]?.rpcMethod, "initialize");
    assert.equal(server.requests.filter((request) => request.rpcMethod === "initialize").length, 1);
  });

  it("raises McpRateLimitError when the retry budget is exhausted", async () => {
    const client = new StreamableHttpMcpClient({
      endpoint: ENDPOINT,
      maxRetries: 1,
      fetchImpl: async () => new Response("slow down", { status: 429, headers: { "retry-after": "0" } }),
    });
    await assert.rejects(
      () => client.initialize(),
      (error: unknown) => error instanceof McpRateLimitError && error.retryAfterSeconds === 0,
    );
  });

  it("raises McpTransportError for a non-2xx HTTP status", async () => {
    const client = new StreamableHttpMcpClient({
      endpoint: ENDPOINT,
      maxRetries: 0,
      fetchImpl: async () => new Response("upstream exploded", { status: 500, statusText: "Internal Server Error" }),
    });
    await assert.rejects(
      () => client.initialize(),
      (error: unknown) => error instanceof McpTransportError && error.message.includes("HTTP 500"),
    );
  });

  it("raises McpTransportError when the request times out", async () => {
    const client = new StreamableHttpMcpClient({
      endpoint: ENDPOINT,
      timeoutMs: 20,
      fetchImpl: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const abort = () => reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort);
        }),
    });
    await assert.rejects(
      () => client.initialize(),
      (error: unknown) => error instanceof McpTransportError && /timed out/.test(error.message),
    );
  });

  it("raises McpTransportError when the endpoint is unreachable", async () => {
    const client = new StreamableHttpMcpClient({
      endpoint: ENDPOINT,
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await assert.rejects(
      () => client.initialize(),
      (error: unknown) => error instanceof McpTransportError && /Could not reach/.test(error.message),
    );
  });
});
