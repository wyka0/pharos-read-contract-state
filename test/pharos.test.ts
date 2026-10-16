import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress } from "viem";

import { DEFAULT_HOLDER, DEFAULT_SPENDER, PHAROS_NETWORK, PHAROS_TOKEN_REGISTRY, labelAddress } from "../src/pharos.js";

/**
 * These invariants guard the one class of mistake that is easy to make by hand
 * and invisible at runtime: a mistyped EIP-55 checksum. Every published address
 * must survive a round-trip through `getAddress`.
 */
describe("published addresses", () => {
  it("are valid EIP-55 checksummed addresses", () => {
    const addresses = [...PHAROS_TOKEN_REGISTRY.map((token) => token.address), DEFAULT_HOLDER, DEFAULT_SPENDER];
    for (const address of addresses) {
      assert.equal(getAddress(address), address, `${address} is not correctly checksummed`);
    }
  });

  it("are unique", () => {
    const seen = new Set<string>();
    for (const token of PHAROS_TOKEN_REGISTRY) {
      const key = token.address.toLowerCase();
      assert.equal(seen.has(key), false, `duplicate registry address ${token.address}`);
      seen.add(key);
    }
  });
});

describe("PHAROS_TOKEN_REGISTRY", () => {
  it("contains the four documented Pacific Mainnet tokens", () => {
    assert.deepEqual(
      PHAROS_TOKEN_REGISTRY.map((token) => token.symbol),
      ["WPROS", "USDC", "LINK", "WETH"],
    );
  });

  it("records the decimals that were confirmed on-chain", () => {
    const bySymbol = new Map(PHAROS_TOKEN_REGISTRY.map((token) => [token.symbol, token.decimals]));
    assert.equal(bySymbol.get("WPROS"), 18);
    assert.equal(bySymbol.get("USDC"), 6);
    assert.equal(bySymbol.get("LINK"), 18);
    assert.equal(bySymbol.get("WETH"), 18);
  });
});

describe("PHAROS_NETWORK", () => {
  it("matches the network facts published by the Chain MCP repository", () => {
    assert.equal(PHAROS_NETWORK.chainId, 1672);
    assert.equal(PHAROS_NETWORK.chainIdHex, "0x688");
    assert.equal(PHAROS_NETWORK.nativeSymbol, "PROS");
    assert.equal(PHAROS_NETWORK.rpcUrl, "https://rpc.pharos.xyz");
    assert.equal(PHAROS_NETWORK.chainMcpEndpoint, "https://mcp.pharos.xyz/mcp");
  });
});

describe("labelAddress", () => {
  it("labels registry addresses regardless of input casing", () => {
    assert.match(labelAddress("0xc879c018db60520f4355c26ed1a6d572cdac1815"), /USDC/);
    assert.match(labelAddress("0x52C48D4213107B20BC583832B0D951FB9CA8F0B0"), /Wrapped PROS/);
  });

  it("does not invent a label for an unknown or missing address", () => {
    assert.equal(labelAddress("0x0000000000000000000000000000000000000001"), "unlabelled address");
    assert.equal(labelAddress(null), "n/a");
    assert.equal(labelAddress(undefined), "n/a");
  });
});
