/**
 * Configuration: environment variables, an optional local `.env` file, and CLI
 * flags. Precedence is CLI flag > environment variable > built-in default.
 *
 * No third-party dotenv dependency is needed; the loader below implements the
 * small subset of the format this project uses (KEY=VALUE, `#` comments).
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { InvalidArgumentError } from "./errors.js";
import { normalizeAddress } from "./chain/erc20.js";
import { DEFAULT_HOLDER, DEFAULT_SPENDER, PHAROS_NETWORK, PHAROS_TOKEN_REGISTRY } from "./pharos.js";

export interface AppConfig {
  endpoint: string;
  expectedChainId: number;
  address: `0x${string}`;
  holder: `0x${string}`;
  spender: `0x${string}`;
  block: string | undefined;
  timeoutMs: number;
  maxRetries: number;
  readRegistry: boolean;
  json: boolean;
  help: boolean;
}

/** Load `KEY=VALUE` pairs from a `.env` file without overriding real env vars. */
export function loadDotEnv(path = resolve(process.cwd(), ".env")): void {
  if (!existsSync(path)) return;
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const HELP_TEXT = `pharos-read-contract-state — read live contract state on Pharos via Chain MCP

Usage:
  node dist/src/index.js [options]

Options:
  -a, --address <0x..>   Contract to inspect (default: USDC from the Pharos token registry)
      --holder <0x..>    Address used as the balanceOf argument
      --spender <0x..>   Address used as the allowance spender argument
      --block <ref>      Pin reads to a block: decimal number, 0x quantity, or
                         latest|earliest|pending|safe|finalized (default: latest at startup)
      --endpoint <url>   Chain MCP endpoint (default: ${PHAROS_NETWORK.chainMcpEndpoint})
      --timeout <ms>     Per-request MCP timeout in milliseconds (default: 20000)
      --retries <n>      Retries after HTTP 429 (default: 2)
      --registry         Also read every token in the Pharos token registry (default: on)
      --no-registry      Skip the registry sweep
      --json             Emit a machine-readable JSON report
  -h, --help             Show this help

Environment: PHAROS_MCP_ENDPOINT, PHAROS_CHAIN_ID, CONTRACT_ADDRESS, HOLDER_ADDRESS,
             SPENDER_ADDRESS, BLOCK_NUMBER, MCP_TIMEOUT_MS, MCP_MAX_RETRIES, READ_REGISTRY

Examples:
  npm start
  npm start -- --address 0x52c48d4213107b20bc583832b0d951fb9ca8f0b0
  npm start -- --json --no-registry`;

function readFlagValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new InvalidArgumentError(`Flag ${flag} requires a value.`);
  }
  return value;
}

function parsePositiveInt(raw: string, label: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new InvalidArgumentError(`${label} must be a positive integer, received ${JSON.stringify(raw)}.`);
  }
  return value;
}

function parseNonNegativeInt(raw: string, label: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new InvalidArgumentError(`${label} must be a non-negative integer, received ${JSON.stringify(raw)}.`);
  }
  return value;
}

/** Parse process arguments plus the environment into a validated config. */
export function parseConfig(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): AppConfig {
  const defaultToken = PHAROS_TOKEN_REGISTRY.find((token) => token.symbol === "USDC") ?? PHAROS_TOKEN_REGISTRY[0];

  let addressInput = env.CONTRACT_ADDRESS?.trim() || defaultToken?.address || "";
  let holderInput = env.HOLDER_ADDRESS?.trim() || DEFAULT_HOLDER;
  let spenderInput = env.SPENDER_ADDRESS?.trim() || DEFAULT_SPENDER;
  let endpoint = env.PHAROS_MCP_ENDPOINT?.trim() || PHAROS_NETWORK.chainMcpEndpoint;
  let block: string | undefined = env.BLOCK_NUMBER?.trim() || undefined;
  let timeoutMs = env.MCP_TIMEOUT_MS ? parsePositiveInt(env.MCP_TIMEOUT_MS, "MCP_TIMEOUT_MS") : 20_000;
  let maxRetries = env.MCP_MAX_RETRIES ? parseNonNegativeInt(env.MCP_MAX_RETRIES, "MCP_MAX_RETRIES") : 2;
  let readRegistry = env.READ_REGISTRY ? env.READ_REGISTRY !== "0" : true;
  let json = false;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    switch (arg) {
      case "-h":
      case "--help":
        help = true;
        break;
      case "-a":
      case "--address":
        addressInput = readFlagValue(argv, i, arg);
        i += 1;
        break;
      case "--holder":
        holderInput = readFlagValue(argv, i, arg);
        i += 1;
        break;
      case "--spender":
        spenderInput = readFlagValue(argv, i, arg);
        i += 1;
        break;
      case "--block":
        block = readFlagValue(argv, i, arg);
        i += 1;
        break;
      case "--endpoint":
        endpoint = readFlagValue(argv, i, arg);
        i += 1;
        break;
      case "--timeout":
        timeoutMs = parsePositiveInt(readFlagValue(argv, i, arg), "--timeout");
        i += 1;
        break;
      case "--retries":
        maxRetries = parseNonNegativeInt(readFlagValue(argv, i, arg), "--retries");
        i += 1;
        break;
      case "--registry":
        readRegistry = true;
        break;
      case "--no-registry":
        readRegistry = false;
        break;
      case "--json":
        json = true;
        break;
      default:
        throw new InvalidArgumentError(`Unknown argument: ${arg}. Run with --help for usage.`);
    }
  }

  if (!/^https?:\/\//i.test(endpoint)) {
    throw new InvalidArgumentError(`--endpoint must be an http(s) URL, received ${JSON.stringify(endpoint)}.`);
  }
  if (block !== undefined && block.trim() === "") block = undefined;

  const expectedChainIdRaw = env.PHAROS_CHAIN_ID?.trim();
  const expectedChainId = expectedChainIdRaw ? parsePositiveInt(expectedChainIdRaw, "PHAROS_CHAIN_ID") : PHAROS_NETWORK.chainId;

  return {
    endpoint,
    expectedChainId,
    // Address parsing throws InvalidAddressError for malformed input.
    address: normalizeAddress(addressInput, "contract address"),
    holder: normalizeAddress(holderInput, "holder address"),
    spender: normalizeAddress(spenderInput, "spender address"),
    block,
    timeoutMs,
    maxRetries,
    readRegistry,
    json,
    help,
  };
}

export { HELP_TEXT };
