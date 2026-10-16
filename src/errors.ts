/**
 * Error types used across the application.
 *
 * Every error carries a stable `code` so the CLI can render a clear, actionable
 * message instead of a raw stack trace, and so tests can assert on failures.
 */

export type PharosErrorCode =
  | "INVALID_ADDRESS"
  | "INVALID_ARGUMENT"
  | "MCP_TRANSPORT"
  | "MCP_PROTOCOL"
  | "MCP_TOOL"
  | "MCP_RATE_LIMIT"
  | "CHAIN_MISMATCH"
  | "NOT_A_CONTRACT";

export class PharosError extends Error {
  readonly code: PharosErrorCode;

  constructor(code: PharosErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/** A supplied address is not a valid EVM address. */
export class InvalidAddressError extends PharosError {
  constructor(input: string, label = "address") {
    super("INVALID_ADDRESS", `Invalid EVM ${label}: ${JSON.stringify(input)}. Expected a 0x-prefixed 20-byte hex address.`);
  }
}

/** A CLI flag or environment variable could not be parsed. */
export class InvalidArgumentError extends PharosError {
  constructor(message: string) {
    super("INVALID_ARGUMENT", message);
  }
}

/** The MCP endpoint could not be reached, timed out, or answered with HTTP != 2xx. */
export class McpTransportError extends PharosError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("MCP_TRANSPORT", message, options);
  }
}

/** The MCP endpoint answered with a JSON-RPC protocol-level error. */
export class McpProtocolError extends PharosError {
  readonly rpcCode: number | undefined;

  constructor(message: string, rpcCode?: number) {
    super("MCP_PROTOCOL", message);
    this.rpcCode = rpcCode;
  }
}

/** An MCP tool executed but reported a failure (e.g. the EVM reverted). */
export class McpToolError extends PharosError {
  readonly tool: string;
  readonly rpcCode: number | undefined;
  readonly data: string | undefined;

  constructor(tool: string, message: string, details?: { rpcCode?: number; data?: string }) {
    super("MCP_TOOL", `MCP tool "${tool}" failed: ${message}`);
    this.tool = tool;
    this.rpcCode = details?.rpcCode;
    this.data = details?.data;
  }
}

/** The MCP endpoint returned HTTP 429 after exhausting the retry budget. */
export class McpRateLimitError extends PharosError {
  readonly retryAfterSeconds: number | undefined;

  constructor(message: string, retryAfterSeconds?: number) {
    super("MCP_RATE_LIMIT", message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The MCP server reported a chain ID that does not match the expected network. */
export class ChainMismatchError extends PharosError {
  constructor(expected: number, actual: number) {
    super("CHAIN_MISMATCH", `Expected Pharos chain ID ${expected}, but the MCP server reported ${actual}. Aborting to avoid reporting data from the wrong network.`);
  }
}

/**
 * `eth_call` reverted. For optional, non-standard methods (such as `owner()`
 * on a WETH-style token) this is a normal outcome, not a crash.
 */
export function isRevertMessage(message: string): boolean {
  return /execution reverted|revert|invalid opcode|call to non-contract|missing revert data/i.test(message);
}
