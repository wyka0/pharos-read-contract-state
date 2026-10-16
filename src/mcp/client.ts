/**
 * Minimal, dependency-free MCP client for the Pharos Chain MCP server.
 *
 * The hosted Chain MCP endpoint (`https://mcp.pharos.xyz/mcp`) speaks the MCP
 * *Streamable HTTP* transport using JSON-RPC 2.0. This module implements
 * exactly the subset the application needs, with no hidden magic:
 *
 *   1. `POST /mcp` with an `initialize` request and
 *      `Accept: application/json, text/event-stream`.
 *   2. Read the `mcp-session-id` response header and echo it on every
 *      subsequent request.
 *   3. Send the `notifications/initialized` notification (HTTP 202, no body).
 *   4. `tools/list` and `tools/call` over the same session.
 *
 * Responses may arrive as `application/json` or as an SSE stream
 * (`text/event-stream`) carrying `data: {...}` frames. Both are handled.
 *
 * Reference: https://github.com/PharosNetwork/pharos-mcp
 */

import { McpProtocolError, McpRateLimitError, McpTransportError } from "../errors.js";

/** MCP protocol revision this client implements (verified against the hosted server). */
export const MCP_PROTOCOL_VERSION = "2024-11-05";

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: Record<string, unknown>;
}

export interface McpTextContent {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface McpToolCallResult {
  content?: McpTextContent[];
  isError?: boolean;
  structuredContent?: unknown;
  [key: string]: unknown;
}

export interface McpServerInfo {
  protocolVersion: string;
  serverInfo?: { name?: string; version?: string };
  instructions?: string;
  capabilities?: Record<string, unknown>;
}

export interface McpClientOptions {
  /** Absolute URL of the MCP endpoint, e.g. https://mcp.pharos.xyz/mcp. */
  endpoint: string;
  /** Injectable fetch, primarily so tests can exercise the protocol without a network. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /** Protocol revision advertised in `initialize`. */
  protocolVersion?: string;
  /** Retries after HTTP 429; the `Retry-After` header is honoured. */
  maxRetries?: number;
  /** Client identity reported to the server. */
  clientInfo?: { name: string; version: string };
}

/** JSON-RPC 2.0 envelope. */
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Extract every JSON payload from an SSE body.
 *
 * SSE frames are separated by a blank line; multiple `data:` lines inside one
 * frame are joined with `\n` per the SSE specification.
 */
export function parseSseJson(body: string): unknown[] {
  const payloads: unknown[] = [];
  for (const frame of body.split(/\r?\n\r?\n/)) {
    const dataLines = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).replace(/^ /, ""));
    if (dataLines.length === 0) continue;
    const data = dataLines.join("\n").trim();
    if (!data) continue;
    try {
      payloads.push(JSON.parse(data));
    } catch {
      // A non-JSON SSE frame is not a JSON-RPC message; ignore it.
    }
  }
  return payloads;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class StreamableHttpMcpClient {
  readonly endpoint: string;

  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly protocolVersion: string;
  private readonly maxRetries: number;
  private readonly clientInfo: { name: string; version: string };

  private sessionId: string | undefined;
  private nextId = 1;
  private serverInfo: McpServerInfo | undefined;
  private initialized = false;

  constructor(options: McpClientOptions) {
    this.endpoint = options.endpoint;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.protocolVersion = options.protocolVersion ?? MCP_PROTOCOL_VERSION;
    this.maxRetries = options.maxRetries ?? 2;
    this.clientInfo = options.clientInfo ?? { name: "pharos-read-contract-state", version: "1.0.0" };

    if (typeof this.fetchImpl !== "function") {
      throw new McpTransportError("No fetch implementation available. Node.js 20+ is required.");
    }
  }

  /** The MCP server's identity, available after `initialize()`. */
  get server(): McpServerInfo | undefined {
    return this.serverInfo;
  }

  /** The `mcp-session-id` assigned by the server, if the server issues one. */
  get currentSessionId(): string | undefined {
    return this.sessionId;
  }

  /**
   * Perform the MCP handshake. Idempotent: calling it twice is a no-op.
   */
  async initialize(): Promise<McpServerInfo> {
    if (this.initialized && this.serverInfo) return this.serverInfo;

    const payloads = await this.#post(
      {
        jsonrpc: "2.0",
        id: this.nextId++,
        method: "initialize",
        params: {
          protocolVersion: this.protocolVersion,
          capabilities: {},
          clientInfo: this.clientInfo,
        },
      },
      { expectResponse: true },
    );

    const result = payloads[0]?.result as McpServerInfo | undefined;
    if (!result || typeof result.protocolVersion !== "string") {
      throw new McpProtocolError("MCP initialize returned no usable server information.");
    }
    this.serverInfo = result;

    // Per spec the client confirms with a notification. The server answers 202.
    await this.#post({ jsonrpc: "2.0", method: "notifications/initialized" }, { expectResponse: false });

    this.initialized = true;
    return result;
  }

  /** List the tools the Chain MCP server exposes. */
  async listTools(): Promise<McpToolDefinition[]> {
    await this.initialize();
    const payloads = await this.#post(
      { jsonrpc: "2.0", id: this.nextId++, method: "tools/list", params: {} },
      { expectResponse: true },
    );
    const result = payloads[0]?.result as { tools?: McpToolDefinition[] } | undefined;
    return result?.tools ?? [];
  }

  /** Invoke a Chain MCP tool. */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolCallResult> {
    await this.initialize();
    const payloads = await this.#post(
      { jsonrpc: "2.0", id: this.nextId++, method: "tools/call", params: { name, arguments: args } },
      { expectResponse: true },
    );

    const message = payloads[0];
    if (!message) throw new McpProtocolError(`MCP tools/call for "${name}" returned no response.`);
    if (message.error) {
      throw new McpProtocolError(`MCP tools/call for "${name}" failed: ${message.error.message}`, message.error.code);
    }
    if (!message.result || typeof message.result !== "object") {
      throw new McpProtocolError(`MCP tools/call for "${name}" returned a malformed result.`);
    }
    return message.result as McpToolCallResult;
  }

  /** Best-effort session teardown; never throws. */
  async close(): Promise<void> {
    if (!this.sessionId) return;
    const session = this.sessionId;
    this.sessionId = undefined;
    this.initialized = false;
    try {
      await this.#rawFetch("DELETE", { headers: { "mcp-session-id": session } });
    } catch {
      // The server may not implement session termination; that is fine.
    }
  }

  async #post(body: unknown, options: { expectResponse: boolean }): Promise<JsonRpcResponse[]> {
    const response = await this.#rawFetch("POST", {
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
        ...(this.initialized ? { "mcp-protocol-version": this.protocolVersion } : {}),
      },
      body: JSON.stringify(body),
    });

    // The initialize response carries the session identifier for the rest of the connection.
    const sessionHeader = response.headers.get("mcp-session-id");
    if (sessionHeader) this.sessionId = sessionHeader;

    if (!options.expectResponse) {
      await response.text().catch(() => "");
      return [];
    }

    const text = await response.text();
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    const messages: JsonRpcResponse[] = contentType.includes("text/event-stream")
      ? (parseSseJson(text) as JsonRpcResponse[])
      : text.trim()
        ? [JSON.parse(text) as JsonRpcResponse]
        : [];

    if (messages.length === 0) {
      throw new McpProtocolError("MCP endpoint returned an empty response where a JSON-RPC message was expected.");
    }
    return messages;
  }

  async #rawFetch(method: string, init: RequestInit): Promise<Response> {
    let attempt = 0;
    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await this.fetchImpl(this.endpoint, { ...init, method, signal: controller.signal });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const timedOut = error instanceof Error && error.name === "AbortError";
        throw new McpTransportError(
          timedOut
            ? `MCP request to ${this.endpoint} timed out after ${this.timeoutMs}ms.`
            : `Could not reach the Chain MCP endpoint ${this.endpoint}: ${reason}`,
          { cause: error },
        );
      } finally {
        clearTimeout(timer);
      }

      if (response.status === 429) {
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        if (attempt < this.maxRetries) {
          attempt += 1;
          await sleep((retryAfter ?? 1) * 1000 * attempt);
          continue;
        }
        throw new McpRateLimitError(
          `Chain MCP rate limit reached (HTTP 429). Retry after ${retryAfter ?? "a few"} seconds, or raise MCP_MAX_RETRIES.`,
          retryAfter,
        );
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new McpTransportError(
          `Chain MCP endpoint ${this.endpoint} answered HTTP ${response.status} ${response.statusText}${
            detail ? `: ${detail.slice(0, 300)}` : ""
          }.`,
        );
      }

      return response;
    }
  }
}
