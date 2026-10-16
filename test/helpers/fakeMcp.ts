/**
 * An in-process fake of the hosted Pharos Chain MCP server.
 *
 * It implements the *real* Streamable HTTP wire protocol — `initialize` with an
 * `mcp-session-id` response header, the `notifications/initialized` 202, then
 * JSON-RPC over `text/event-stream` — so the production client in
 * `src/mcp/client.ts` is exercised unmodified. Only the tool *results* are
 * scripted fixtures.
 *
 * This is used exclusively by unit tests. The live check in `test/live-check.ts`
 * talks to the real endpoint at https://mcp.pharos.xyz/mcp instead.
 */

export interface FakeToolResult {
  data: unknown;
  isError?: boolean;
}

export type FakeToolHandler = (args: Record<string, unknown>) => FakeToolResult | Promise<FakeToolResult>;

export interface RecordedRequest {
  httpMethod: string;
  rpcMethod?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  headers: Record<string, string>;
}

export interface FakeServerOptions {
  /** Dispatch table for `tools/call`, keyed by Chain MCP tool name. */
  handlers: Record<string, FakeToolHandler>;
  /** Names returned from `tools/list`. Defaults to the handler keys. */
  toolNames?: string[];
  sessionId?: string | null;
  protocolVersion?: string;
}

export class FakeChainMcpServer {
  readonly requests: RecordedRequest[] = [];
  readonly sessionId: string;
  private readonly options: FakeServerOptions;

  constructor(options: FakeServerOptions) {
    this.options = options;
    this.sessionId = options.sessionId === null ? "" : (options.sessionId ?? "fake-session-0001");
  }

  /** Count how many times a given tool was invoked. */
  countToolCalls(toolName: string): number {
    return this.requests.filter((request) => request.toolName === toolName).length;
  }

  /** A `fetch` implementation suitable for injecting into the MCP client. */
  readonly fetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const httpMethod = (init?.method ?? "GET").toUpperCase();
    const headers = normalizeHeaders(init?.headers);

    if (httpMethod === "DELETE") {
      this.requests.push({ httpMethod, headers });
      return new Response(null, { status: 204 });
    }

    if (httpMethod !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    if (!url.includes("/mcp")) {
      return new Response("Not Found", { status: 404 });
    }

    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const rpcMethod = typeof body.method === "string" ? body.method : undefined;

    if (rpcMethod === "notifications/initialized") {
      this.requests.push({ httpMethod, rpcMethod, headers });
      return new Response(null, { status: 202 });
    }

    if (rpcMethod === "initialize") {
      this.requests.push({ httpMethod, rpcMethod, headers });
      return this.sse({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: this.options.protocolVersion ?? "2024-11-05",
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: "pharos-mcp-server", version: "0.1.0" },
          instructions: "Pharos EVM JSON-RPC tools.",
        },
      });
    }

    if (rpcMethod === "tools/list") {
      this.requests.push({ httpMethod, rpcMethod, headers });
      return this.sse({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          tools: (this.options.toolNames ?? Object.keys(this.options.handlers)).map((name) => ({
            name,
            description: `${name} (fixture)`,
          })),
        },
      });
    }

    if (rpcMethod === "tools/call") {
      const params = (body.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      const toolName = params.name ?? "";
      const args = params.arguments ?? {};
      this.requests.push({ httpMethod, rpcMethod, toolName, args, headers });

      const handler = this.options.handlers[toolName];
      if (!handler) {
        return this.sse({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [{ type: "text", text: JSON.stringify({ error: { message: `Unknown tool: ${toolName}` } }) }],
            isError: true,
          },
        });
      }

      const result = await handler(args);
      return this.sse({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result.data) }],
          ...(result.isError ? { isError: true } : {}),
        },
      });
    }

    return this.sse({
      jsonrpc: "2.0",
      id: body.id,
      error: { code: -32601, message: `Method not found: ${String(rpcMethod)}` },
    });
  };

  private sse(message: unknown): Response {
    const headers: Record<string, string> = { "content-type": "text/event-stream" };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    return new Response(`event: message\ndata: ${JSON.stringify(message)}\n\n`, { status: 200, headers });
  }
}

function normalizeHeaders(init: NonNullable<Parameters<typeof fetch>[1]>["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init) return out;
  if (init instanceof Headers) {
    init.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }
  if (Array.isArray(init)) {
    for (const [key, value] of init) if (key !== undefined && value !== undefined) out[key.toLowerCase()] = value;
    return out;
  }
  for (const [key, value] of Object.entries(init)) if (value !== undefined) out[key.toLowerCase()] = String(value);
  return out;
}
