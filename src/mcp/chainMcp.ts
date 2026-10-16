/**
 * Typed facade over the Pharos Chain MCP tools.
 *
 * The hosted server exposes 13 read-only JSON-RPC tools. This class wraps the
 * four the application actually needs and normalises their JSON-string
 * payloads into typed values:
 *
 *   - `get_chain_info`  -> network identity and the latest block
 *   - `get_code`        -> confirm an address really is a deployed contract
 *   - `eth_call`        -> read-only contract call, pinnable to a block
 *   - `get_block_number`-> current height
 *
 * Tool schemas are taken from the server source:
 * https://github.com/PharosNetwork/pharos-mcp/blob/main/src/server.ts
 */

import { McpToolError, isRevertMessage } from "../errors.js";
import { StreamableHttpMcpClient, type McpToolDefinition } from "./client.js";

export interface ChainInfo {
  name: string;
  chainId: number;
  chainIdHex: string;
  expectedChainId: number;
  chainIdMatches: boolean;
  latestBlock: string;
  latestBlockHex: string;
  nativeSymbol: string;
  clientVersion: string;
  rpcUrl: string;
}

export interface EthCallTransaction {
  from?: string;
  to?: string;
  data?: string;
  value?: string;
}

export type BlockTag = "latest" | "earliest" | "pending" | "safe" | "finalized";

/** A block reference the Chain MCP tools accept: a named tag, decimal number or 0x quantity. */
export type BlockReference = BlockTag | number | string;

/** Normalise a block reference into the form the MCP tools document. */
export function normalizeBlock(block: BlockReference | undefined): BlockReference | undefined {
  if (block === undefined) return undefined;
  if (typeof block === "number") {
    if (!Number.isInteger(block) || block < 0) throw new McpToolError("eth_call", `Invalid block number: ${block}`);
    return block;
  }
  return block;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class PharosChainMcp {
  private readonly client: StreamableHttpMcpClient;

  constructor(client: StreamableHttpMcpClient) {
    this.client = client;
  }

  static fromEndpoint(endpoint: string, options?: { timeoutMs?: number; maxRetries?: number; fetchImpl?: typeof fetch }) {
    return new PharosChainMcp(
      new StreamableHttpMcpClient({
        endpoint,
        timeoutMs: options?.timeoutMs,
        maxRetries: options?.maxRetries,
        fetchImpl: options?.fetchImpl,
      }),
    );
  }

  async initialize(): Promise<void> {
    await this.client.initialize();
  }

  close(): Promise<void> {
    return this.client.close();
  }

  get serverInfo() {
    return this.client.server;
  }

  /** The Chain MCP endpoint this instance is bound to. */
  get endpoint(): string {
    return this.client.endpoint;
  }

  async listTools(): Promise<McpToolDefinition[]> {
    return this.client.listTools();
  }

  /** `get_chain_info` — chain ID, client version and the latest block. */
  async getChainInfo(): Promise<ChainInfo> {
    return this.callTool<ChainInfo>("get_chain_info", {});
  }

  /** `get_block_number` — current block height as a decimal string. */
  async getBlockNumber(): Promise<string> {
    const result = await this.callTool<{ blockNumber: string }>("get_block_number", {});
    return result.blockNumber;
  }

  /** `get_code` — deployed bytecode, or `0x` when the address has no contract. */
  async getCode(address: string, block?: BlockReference): Promise<string> {
    const result = await this.callTool<{ code: string }>("get_code", { address, block: normalizeBlock(block) });
    return result.code;
  }

  /**
   * `eth_call` — execute a read-only EVM call and return the raw hex result.
   * Throws {@link McpToolError} when the EVM reverts.
   */
  async ethCall(transaction: EthCallTransaction, block?: BlockReference): Promise<string> {
    const result = await this.callTool<{ result: string }>("eth_call", {
      transaction,
      block: normalizeBlock(block),
    });
    return result.result;
  }

  /**
   * Call a tool, decode its JSON text payload, and surface tool-level failures
   * as {@link McpToolError} carrying the upstream JSON-RPC code when present.
   */
  async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    let raw: Awaited<ReturnType<StreamableHttpMcpClient["callTool"]>>;
    try {
      raw = await this.client.callTool(name, args);
    } catch (error) {
      // Transport/protocol failures are already typed; rethrow untouched.
      throw error;
    }

    const text = (raw.content ?? [])
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text as string)
      .join("\n")
      .trim();

    const payload = text ? safeJsonParse(text) : undefined;

    if (raw.isError) {
      const detail = isJsonObject(payload) && isJsonObject(payload.error) ? payload.error : undefined;
      const message = typeof detail?.message === "string" ? detail.message : text || `${name} reported an error.`;
      throw new McpToolError(name, message, {
        rpcCode: typeof detail?.code === "number" ? detail.code : undefined,
        data: typeof detail?.data === "string" ? detail.data : undefined,
      });
    }

    if (payload === undefined) {
      throw new McpToolError(name, "Tool returned no JSON payload.");
    }
    return payload as T;
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** True when a tool failure is an EVM revert rather than a transport problem. */
export function isRevertError(error: unknown): boolean {
  return error instanceof McpToolError && isRevertMessage(error.message);
}
