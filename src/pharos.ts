/**
 * Verified Pharos Pacific Mainnet facts and the official token registry.
 *
 * Sources (both published by Pharos, read 2026-10-16):
 *   - https://github.com/PharosNetwork/pharos-mcp  (chain ID, RPC, MCP endpoint)
 *   - https://docs.pharos.xyz/getting-started/token-registry.md
 *
 * Every address below was additionally confirmed live on-chain by reading
 * `eth_getCode`, `name()`, `symbol()` and `decimals()` through Chain MCP before
 * being committed here. Nothing in this file is guessed.
 */

export const PHAROS_NETWORK = {
  name: "Pharos Pacific Mainnet",
  chainId: 1672,
  chainIdHex: "0x688",
  nativeSymbol: "PROS",
  rpcUrl: "https://rpc.pharos.xyz",
  chainMcpEndpoint: "https://mcp.pharos.xyz/mcp",
  explorerUrl: "https://pharosscan.xyz",
} as const;

export interface RegistryToken {
  /** ERC-20 symbol as confirmed on-chain. */
  symbol: string;
  /** ERC-20 name as confirmed on-chain. */
  name: string;
  /** Checksummed contract address from the official registry. */
  address: `0x${string}`;
  /** Decimals as confirmed on-chain. */
  decimals: number;
  /** Free-form provenance note shown in the report. */
  note: string;
}

/**
 * Contract addresses published in the Pharos Pacific Mainnet token registry.
 * `name`, `symbol` and `decimals` were re-read from the contracts themselves.
 */
export const PHAROS_TOKEN_REGISTRY: readonly RegistryToken[] = [
  {
    symbol: "WPROS",
    name: "Wrapped PROS",
    address: "0x52C48d4213107b20bC583832b0d951FB9CA8F0B0",
    decimals: 18,
    note: "Wrapped native PROS",
  },
  {
    symbol: "USDC",
    name: "USDC",
    address: "0xC879C018dB60520F4355C26eD1a6D572cdAC1815",
    decimals: 6,
    note: "Circle-deployed USDC",
  },
  {
    symbol: "LINK",
    name: "ChainLink Token",
    address: "0x51e2A24742Db77604B881d6781Ee16B5b8fcBE29",
    decimals: 18,
    note: "Chainlink LINK",
  },
  {
    symbol: "WETH",
    name: "Wrapped Ether",
    address: "0x1f4b7011Ee3d53969bb67F59428a9ec0477856E9",
    decimals: 18,
    note: "Wrapped Ether",
  },
] as const;

/**
 * Default `balanceOf` argument: a wallet that actively transacted on Pharos
 * during this run's discovery sweep, so the read returns a meaningful,
 * non-zero balance. Override with `--holder`.
 */
export const DEFAULT_HOLDER = "0x912c9aDe24D44d8922f0866D8Dcb079f1363f647" as const;

/**
 * Default `allowance` spender argument: the Uniswap SwapRouter addressed by the
 * Pharosscan explorer. Override with `--spender`.
 */
export const DEFAULT_SPENDER = "0xf38d34c8382b9079b0f85309578b43b8479Cd875" as const;

/**
 * Human-readable labels for addresses that appear in output. Only addresses
 * with a published source are listed; anything else is reported as unlabelled
 * rather than guessed at.
 */
const ADDRESS_LABELS: ReadonlyMap<string, string> = new Map(
  PHAROS_TOKEN_REGISTRY.map((token) => [token.address.toLowerCase(), `${token.name} (${token.symbol}) contract`]),
);

export function labelAddress(address: string | undefined | null): string {
  if (!address) return "n/a";
  return ADDRESS_LABELS.get(address.toLowerCase()) ?? "unlabelled address";
}
