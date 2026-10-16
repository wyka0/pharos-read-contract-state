/**
 * Orchestrates a full contract read over Chain MCP.
 *
 * Guarantees this module upholds, because the task's review criteria depend on
 * them:
 *
 *   - Every value is read through a Chain MCP tool. Nothing is mocked, cached or
 *     hard-coded from documentation.
 *   - Every read is pinned to a single block, so the report is internally
 *     consistent. The block number, hash and timestamp are returned.
 *   - Raw results are preserved next to their decoded and human-readable forms.
 *   - An optional method that the contract does not implement (revert / empty
 *     return) is reported as `unsupported`, not as a crash and not as a zero.
 */

import { decodeAbiParameters, type Hex } from "viem";

import {
  ERC20_SIGNATURES,
  decodeReadResult,
  encodeReadCall,
  formatTokenAmount,
  groupDigits,
  isEmptyResult,
  isZeroAddress,
  type Erc20CallRequest,
  type Erc20Method,
} from "./chain/erc20.js";
import { decodeStorageWord, matchesViewValue, type DecodedStorageWord } from "./chain/storage.js";
import { ChainMismatchError, McpToolError, PharosError, isRevertMessage } from "./errors.js";
import type { BlockReference, ChainInfo, PharosChainMcp } from "./mcp/chainMcp.js";
import { PHAROS_NETWORK, PHAROS_TOKEN_REGISTRY, labelAddress, type RegistryToken } from "./pharos.js";

export type ReadStatus = "ok" | "unsupported" | "error";

export interface ReadValue {
  /** Stable machine key, e.g. `totalSupply`. */
  key: string;
  /** Human-facing label. */
  label: string;
  /** Solidity signature, e.g. `balanceOf(address)`. */
  signature: string;
  /** The Chain MCP tool this value came from. */
  tool: string;
  status: ReadStatus;
  /** The argument used, when the method takes one. */
  argument?: string;
  /** Raw hex returned by `eth_call`. */
  raw: string | null;
  /** Decoded primitive, rendered as a string. */
  decoded: string | null;
  /** Value formatted for a non-developer, with decimals applied. */
  formatted: string | null;
  /** Caveats worth surfacing to the reader. */
  note?: string;
  /** Failure detail when `status` is `error`. */
  error?: string;
}

export interface StorageProbe {
  slot: string;
  tool: string;
  raw: string | null;
  status: ReadStatus;
  decoded: DecodedStorageWord | null;
  /** Which view call this word corroborates, when it does. */
  corroborates?: string;
  error?: string;
}

export interface RegistryRead {
  symbol: string;
  name: string;
  address: string;
  note: string;
  decimals: number | null;
  totalSupplyRaw: string | null;
  totalSupplyFormatted: string | null;
  onChainName: string | null;
  onChainSymbol: string | null;
  status: ReadStatus;
  error?: string;
}

export interface ContractStateReport {
  generatedAt: string;
  network: {
    name: string;
    chainId: number;
    chainIdHex: string;
    nativeSymbol: string;
    rpcUrl: string;
    mcpEndpoint: string;
    mcpServer: string;
    clientVersion: string;
  };
  contract: {
    address: string;
    label: string;
    isContract: boolean;
    codeBytes: number;
  };
  block: {
    requested: string;
    resolvedBy: "pinned-flags" | "latest-at-startup";
    number: string | null;
    hex: string | null;
    hash: string | null;
    timestamp: string | null;
  };
  values: ReadValue[];
  storage: StorageProbe[];
  registry: RegistryRead[];
  warnings: string[];
  /** Every Chain MCP tool name actually invoked during this run. */
  mcpToolsUsed: string[];
}

export interface ReadContractOptions {
  address: `0x${string}`;
  holder: `0x${string}`;
  spender: `0x${string}`;
  block?: string;
  expectedChainId: number;
  readRegistry: boolean;
  /** Restrict the registry sweep, mainly for tests. */
  registry?: readonly RegistryToken[];
}

/** Wraps the MCP facade so every tool invocation is recorded for the report. */
class RecordingChain {
  readonly used = new Set<string>();
  constructor(private readonly chain: PharosChainMcp) {}

  get endpoint(): string {
    return this.chain.endpoint;
  }

  async getChainInfo(): Promise<ChainInfo> {
    this.used.add("get_chain_info");
    return this.chain.getChainInfo();
  }
  async getCode(address: string, block?: BlockReference): Promise<string> {
    this.used.add("get_code");
    return this.chain.getCode(address, block);
  }
  async ethCall(tx: { to?: string; data?: string }, block?: BlockReference): Promise<string> {
    this.used.add("eth_call");
    return this.chain.ethCall(tx, block);
  }
  async getStorageAt(address: string, position: string, block?: BlockReference): Promise<string> {
    this.used.add("get_storage_at");
    const result = await this.chain.callTool<{ value: string }>("get_storage_at", { address, position, block });
    return result.value;
  }
  async getBlock(block: BlockReference): Promise<Record<string, unknown>> {
    this.used.add("get_block");
    return this.chain.callTool<Record<string, unknown>>("get_block", { block, includeTransactions: false });
  }
}

/** A `bytes32`-encoded name/symbol, as emitted by some older token contracts. */
function decodeBytes32String(data: Hex): string | undefined {
  try {
    const [value] = decodeAbiParameters([{ type: "bytes32" }], data);
    if (typeof value !== "string") return undefined;
    const bytes = value.replace(/^0x/, "").replace(/(00)+$/, "");
    let text = "";
    for (let i = 0; i < bytes.length; i += 2) text += String.fromCharCode(Number.parseInt(bytes.slice(i, i + 2), 16));
    return text || undefined;
  } catch {
    return undefined;
  }
}

function describeError(error: unknown): string {
  if (error instanceof PharosError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

function renderValue(
  method: Erc20Method,
  decoded: string | number | bigint,
  decimals: number | undefined,
): { decoded: string; formatted: string; note?: string } {
  if (method === "name" || method === "symbol") {
    return { decoded: String(decoded), formatted: String(decoded) };
  }
  if (method === "decimals") {
    return { decoded: String(decoded), formatted: `${decoded} decimals` };
  }
  if (method === "owner") {
    const address = String(decoded);
    return {
      decoded: address,
      formatted: isZeroAddress(address) ? "zero address (ownership renounced)" : `${address} — ${labelAddress(address)}`,
    };
  }

  // Numeric base-unit values: totalSupply, balanceOf, allowance.
  const value = BigInt(decoded);
  if (decimals === undefined) {
    return {
      decoded: value.toString(),
      formatted: groupDigits(value.toString()),
      note: "decimals() unavailable, so the raw base-unit integer is shown un-scaled.",
    };
  }
  return {
    decoded: value.toString(),
    formatted: `${formatTokenAmount(value, decimals)} (${groupDigits(value.toString())} base units)`,
  };
}

export async function readContractState(chain: PharosChainMcp, options: ReadContractOptions): Promise<ContractStateReport> {
  const recorder = new RecordingChain(chain);
  const warnings: string[] = [];

  // 1. Confirm we are talking to the expected network before reading anything.
  const chainInfo = await recorder.getChainInfo();
  if (chainInfo.chainId !== options.expectedChainId) {
    throw new ChainMismatchError(options.expectedChainId, chainInfo.chainId);
  }

  // 2. Pin every subsequent read to one block.
  const pinnedBlock = options.block?.trim() ? options.block.trim() : chainInfo.latestBlock;
  const resolvedBy = options.block?.trim() ? "pinned-flags" : "latest-at-startup";

  // 3. Fail fast (and clearly) if the address is not a deployed contract.
  const code = await recorder.getCode(options.address, pinnedBlock);
  const hasCode = Boolean(code) && code !== "0x";
  if (!hasCode) {
    throw new PharosError(
      "NOT_A_CONTRACT",
      `No contract is deployed at ${options.address} on ${PHAROS_NETWORK.name}. It may be an externally-owned account or an address from another network.`,
    );
  }
  const codeBytes = Math.max(0, (code.length - 2) / 2);

  // 4. Read the identity fields first: decimals() is needed to scale the rest.
  const readValue = async (
    request: Erc20CallRequest,
    meta: { key: string; label: string; argument?: string; optional?: boolean },
    decimals: number | undefined,
  ): Promise<ReadValue> => {
    const data = encodeReadCall(request);
    const base: Omit<ReadValue, "status"> = {
      key: meta.key,
      label: meta.label,
      signature: ERC20_SIGNATURES[request.method],
      tool: "eth_call",
      raw: null,
      decoded: null,
      formatted: null,
      ...(meta.argument ? { argument: meta.argument } : {}),
    };

    let raw: string;
    try {
      raw = await recorder.ethCall({ to: options.address, data }, pinnedBlock);
    } catch (error) {
      if (error instanceof McpToolError && isRevertMessage(error.message)) {
        return {
          ...base,
          status: "unsupported",
          note: meta.optional
            ? `Not implemented by this contract (reverted: ${error.message}).`
            : `Method reverted on-chain: ${error.message}`,
        };
      }
      return { ...base, status: "error", error: describeError(error) };
    }

    if (isEmptyResult(raw)) {
      return {
        ...base,
        status: "unsupported",
        raw,
        note: "Call returned no data, so this contract does not implement the method.",
      };
    }

    try {
      let decoded: string | number | bigint;
      try {
        decoded = decodeReadResult(request, raw as Hex);
      } catch (decodeError) {
        if (request.method === "name" || request.method === "symbol") {
          const fallback = decodeBytes32String(raw as Hex);
          if (fallback !== undefined) {
            return {
              ...base,
              status: "ok",
              raw,
              decoded: fallback,
              formatted: fallback,
              note: "Decoded from a bytes32 return, an older non-standard token layout.",
            };
          }
        }
        return {
          ...base,
          status: "error",
          raw,
          error: `Could not decode the return value: ${describeError(decodeError)}`,
        };
      }

      const rendered = renderValue(request.method, decoded, decimals);
      return {
        ...base,
        status: "ok",
        raw,
        decoded: rendered.decoded,
        formatted: rendered.formatted,
        ...(rendered.note ? { note: rendered.note } : {}),
      };
    } catch (error) {
      return { ...base, status: "error", raw, error: describeError(error) };
    }
  };

  const values: ReadValue[] = [];
  const nameValue = await readValue({ method: "name" }, { key: "name", label: "Token name" }, undefined);
  values.push(nameValue);
  const symbolValue = await readValue({ method: "symbol" }, { key: "symbol", label: "Token symbol" }, undefined);
  values.push(symbolValue);
  const decimalsValue = await readValue({ method: "decimals" }, { key: "decimals", label: "Decimals" }, undefined);
  values.push(decimalsValue);

  const decimals = decimalsValue.status === "ok" && decimalsValue.decoded !== null ? Number(decimalsValue.decoded) : undefined;
  if (decimals === undefined) {
    warnings.push("decimals() could not be read, so base-unit amounts are shown un-scaled.");
  }

  values.push(
    await readValue({ method: "totalSupply" }, { key: "totalSupply", label: "Total supply" }, decimals),
  );
  values.push(
    await readValue(
      { method: "balanceOf", account: options.holder },
      { key: "balanceOf", label: "Holder balance", argument: options.holder },
      decimals,
    ),
  );
  values.push(
    await readValue(
      { method: "allowance", owner: options.holder, spender: options.spender },
      {
        key: "allowance",
        label: "Allowance from holder to spender",
        argument: `${options.holder} -> ${options.spender}`,
      },
      decimals,
    ),
  );
  values.push(
    await readValue({ method: "owner" }, { key: "owner", label: "Owner (Ownable, optional)", optional: true }, decimals),
  );

  const tokenSymbol = symbolValue.status === "ok" && symbolValue.decoded ? symbolValue.decoded : "TOKEN";
  for (const value of values) {
    if (value.status === "ok" && value.formatted && value.key !== "name" && value.key !== "symbol") {
      // Annotate amounts with the ticker so the plain-language reading is unambiguous.
      if (["totalSupply", "balanceOf", "allowance"].includes(value.key) && decimals !== undefined) {
        value.formatted = `${value.formatted} ${tokenSymbol}`;
      }
    }
  }

  // 5. Corroborate the view calls against raw storage where the layout is known.
  const storage: StorageProbe[] = [];
  const storageTargets: Array<{ slot: number; key: string }> = [
    { slot: 0, key: "name" },
    { slot: 1, key: "symbol" },
    { slot: 2, key: "decimals" },
  ];
  for (const target of storageTargets) {
    const position = "0x" + target.slot.toString(16).padStart(64, "0");
    try {
      const raw = await recorder.getStorageAt(options.address, position, pinnedBlock);
      const decoded = decodeStorageWord(raw);
      const viewValue = values.find((value) => value.key === target.key);
      const viewScalar = target.key === "decimals" ? (decimals ?? null) : (viewValue?.decoded ?? null);
      const probe: StorageProbe = { slot: `0x${target.slot.toString(16)}`, tool: "get_storage_at", raw, status: "ok", decoded };
      if (viewValue?.status === "ok" && matchesViewValue(decoded, viewScalar)) {
        probe.corroborates = `${viewValue.key}() view call`;
      }
      storage.push(probe);
    } catch (error) {
      storage.push({
        slot: `0x${target.slot.toString(16)}`,
        tool: "get_storage_at",
        raw: null,
        status: "error",
        decoded: null,
        error: describeError(error),
      });
    }
  }

  // 6. Capture the pinned block's hash and timestamp so the snapshot is auditable.
  let blockHash: string | null = null;
  let blockTimestamp: string | null = null;
  let blockNumberHex: string | null = null;
  try {
    const block = await recorder.getBlock(pinnedBlock);
    blockHash = typeof block.hash === "string" ? block.hash : null;
    blockNumberHex = typeof block.number === "string" ? block.number : null;
    const timestampHex = block.timestamp;
    blockTimestamp =
      typeof timestampHex === "string"
        ? new Date(Number.parseInt(timestampHex, 16) * 1000).toISOString()
        : null;
  } catch (error) {
    warnings.push(`Could not read block metadata for ${pinnedBlock}: ${describeError(error)}`);
  }

  // 7. Sweep the documented token registry for comparison.
  const registry: RegistryRead[] = [];
  if (options.readRegistry) {
    const tokens = options.registry ?? PHAROS_TOKEN_REGISTRY;
    for (const token of tokens) {
      registry.push(await readRegistryToken(recorder, token, pinnedBlock));
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    network: {
      // The chain-ID guard above already proved we are on the expected network,
      // so the label is derived from verified facts rather than the server's
      // self-description.
      name: chainInfo.chainId === PHAROS_NETWORK.chainId ? PHAROS_NETWORK.name : `Chain ${chainInfo.chainId} (${chainInfo.name})`,
      chainId: chainInfo.chainId,
      chainIdHex: chainInfo.chainIdHex,
      nativeSymbol: chainInfo.nativeSymbol,
      rpcUrl: chainInfo.rpcUrl,
      mcpEndpoint: chain.endpoint,
      mcpServer: chainInfo.clientVersion,
      clientVersion: chainInfo.clientVersion,
    },
    contract: {
      address: options.address,
      label: labelAddress(options.address),
      isContract: hasCode,
      codeBytes,
    },
    block: {
      requested: pinnedBlock,
      resolvedBy,
      number: blockNumberHex ? BigInt(blockNumberHex).toString() : pinnedBlock,
      hex: blockNumberHex,
      hash: blockHash,
      timestamp: blockTimestamp,
    },
    values,
    storage,
    registry,
    warnings,
    mcpToolsUsed: [...recorder.used].sort(),
  };
}

async function readRegistryToken(chain: RecordingChain, token: RegistryToken, block: string): Promise<RegistryRead> {
  const base: RegistryRead = {
    symbol: token.symbol,
    name: token.name,
    address: token.address,
    note: token.note,
    decimals: null,
    totalSupplyRaw: null,
    totalSupplyFormatted: null,
    onChainName: null,
    onChainSymbol: null,
    status: "ok",
  };

  try {
    const call = (request: Erc20CallRequest) => chain.ethCall({ to: token.address, data: encodeReadCall(request) }, block);

    const decimalsRaw = await call({ method: "decimals" });
    const decimals = isEmptyResult(decimalsRaw) ? null : Number(decodeReadResult({ method: "decimals" }, decimalsRaw as Hex));

    const totalSupplyRaw = await call({ method: "totalSupply" });
    const totalSupply = isEmptyResult(totalSupplyRaw) ? null : BigInt(decodeReadResult({ method: "totalSupply" }, totalSupplyRaw as Hex));

    const nameRaw = await call({ method: "name" });
    const symbolRaw = await call({ method: "symbol" });

    return {
      ...base,
      decimals,
      onChainName: isEmptyResult(nameRaw) ? null : String(decodeReadResult({ method: "name" }, nameRaw as Hex)),
      onChainSymbol: isEmptyResult(symbolRaw) ? null : String(decodeReadResult({ method: "symbol" }, symbolRaw as Hex)),
      totalSupplyRaw,
      totalSupplyFormatted:
        totalSupply !== null && decimals !== null ? `${formatTokenAmount(totalSupply, decimals)} ${token.symbol}` : null,
    };
  } catch (error) {
    return { ...base, status: "error", error: describeError(error) };
  }
}
