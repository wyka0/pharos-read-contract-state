/**
 * Standard ERC-20 read methods, encoded and decoded with viem.
 *
 * Only `view` methods are present: this application never writes to the chain.
 * `owner()` is included even though it is not part of ERC-20 — it is the
 * conventional Ownable accessor and is exercised as an explicitly optional read
 * so that contracts which do not implement it are reported clearly rather than
 * crashing the run.
 */

import {
  decodeFunctionResult,
  encodeFunctionData,
  formatUnits,
  getAddress,
  isAddress,
  type Abi,
  type Hex,
} from "viem";

import { InvalidAddressError } from "../errors.js";

export const erc20ReadAbi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const satisfies Abi;

export type Erc20Method = "name" | "symbol" | "decimals" | "totalSupply" | "balanceOf" | "allowance" | "owner";

export type Erc20CallRequest =
  | { method: "name" | "symbol" | "decimals" | "totalSupply" | "owner" }
  | { method: "balanceOf"; account: `0x${string}` }
  | { method: "allowance"; owner: `0x${string}`; spender: `0x${string}` };

export type Erc20DecodedValue = string | number | bigint;

/** Canonical signature string for display, e.g. `balanceOf(address)`. */
export const ERC20_SIGNATURES: Record<Erc20Method, string> = {
  name: "name()",
  symbol: "symbol()",
  decimals: "decimals()",
  totalSupply: "totalSupply()",
  balanceOf: "balanceOf(address)",
  allowance: "allowance(address,address)",
  owner: "owner()",
};

/**
 * Validate and checksum an EVM address, throwing a typed error when invalid.
 *
 * Input is accepted in any casing. A mixed-case address whose EIP-55 checksum is
 * wrong (a very common copy-paste artefact) is re-checksummed from its lowercase
 * form rather than rejected, because the address itself is still unambiguous.
 */
export function normalizeAddress(input: string, label = "address"): `0x${string}` {
  const trimmed = input.trim();
  if (!isAddress(trimmed, { strict: false })) throw new InvalidAddressError(trimmed, label);
  try {
    return getAddress(trimmed);
  } catch {
    // Mixed-case input with a bad checksum: normalise via lowercase.
    return getAddress(trimmed.toLowerCase() as `0x${string}`);
  }
}

export function isZeroAddress(address: string): boolean {
  return /^0x0{40}$/i.test(address);
}

/** ABI-encode a read call. */
export function encodeReadCall(request: Erc20CallRequest): Hex {
  switch (request.method) {
    case "name":
      return encodeFunctionData({ abi: erc20ReadAbi, functionName: "name" });
    case "symbol":
      return encodeFunctionData({ abi: erc20ReadAbi, functionName: "symbol" });
    case "decimals":
      return encodeFunctionData({ abi: erc20ReadAbi, functionName: "decimals" });
    case "totalSupply":
      return encodeFunctionData({ abi: erc20ReadAbi, functionName: "totalSupply" });
    case "owner":
      return encodeFunctionData({ abi: erc20ReadAbi, functionName: "owner" });
    case "balanceOf":
      return encodeFunctionData({ abi: erc20ReadAbi, functionName: "balanceOf", args: [request.account] });
    case "allowance":
      return encodeFunctionData({
        abi: erc20ReadAbi,
        functionName: "allowance",
        args: [request.owner, request.spender],
      });
  }
}

/** ABI-decode the raw hex returned by `eth_call`. */
export function decodeReadResult(request: Erc20CallRequest, data: Hex): Erc20DecodedValue {
  switch (request.method) {
    case "name":
      return decodeFunctionResult({ abi: erc20ReadAbi, functionName: "name", data });
    case "symbol":
      return decodeFunctionResult({ abi: erc20ReadAbi, functionName: "symbol", data });
    case "decimals":
      return decodeFunctionResult({ abi: erc20ReadAbi, functionName: "decimals", data });
    case "totalSupply":
      return decodeFunctionResult({ abi: erc20ReadAbi, functionName: "totalSupply", data });
    case "owner":
      return decodeFunctionResult({ abi: erc20ReadAbi, functionName: "owner", data });
    case "balanceOf":
      return decodeFunctionResult({ abi: erc20ReadAbi, functionName: "balanceOf", data });
    case "allowance":
      return decodeFunctionResult({ abi: erc20ReadAbi, functionName: "allowance", data });
  }
}

/** Raw hex is empty or shorter than one 32-byte word: the method is not implemented. */
export function isEmptyResult(data: string): boolean {
  return !data || data === "0x" || data.replace(/^0x/, "").length < 64;
}

/**
 * Format a base-unit integer for humans using the token's decimals, grouping
 * the integer part in threes. Returns the exact value — never a rounded or
 * approximate one.
 */
export function formatTokenAmount(value: bigint, decimals: number): string {
  const formatted = formatUnits(value, decimals);
  const negative = formatted.startsWith("-");
  const body = negative ? formatted.slice(1) : formatted;
  const [integer = "0", fraction] = body.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

/** Group a plain integer (used for wei/PROS and raw base units). */
export function groupDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
