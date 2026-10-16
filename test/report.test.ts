import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderJson, renderReport, summarizeStatus } from "../src/report.js";
import type { ContractStateReport } from "../src/reader.js";

const REPORT: ContractStateReport = {
  generatedAt: "2026-10-16T03:58:14.000Z",
  network: {
    name: "Pharos Pacific Mainnet",
    chainId: 1672,
    chainIdHex: "0x688",
    nativeSymbol: "PROS",
    rpcUrl: "https://rpc.pharos.xyz",
    mcpEndpoint: "https://mcp.pharos.xyz/mcp",
    mcpServer: "portal/1.0.0",
    clientVersion: "portal/1.0.0",
  },
  contract: {
    address: "0xc879C018dB60520f4355C26ED1A6D572cdac1815",
    label: "USDC (USDC) contract",
    isContract: true,
    codeBytes: 1798,
  },
  block: {
    requested: "20360972",
    resolvedBy: "latest-at-startup",
    number: "20360972",
    hex: "0x136b0ec",
    hash: `0x${"cd".repeat(32)}`,
    timestamp: "2026-10-16T03:57:24.000Z",
  },
  values: [
    {
      key: "name",
      label: "Token name",
      signature: "name()",
      tool: "eth_call",
      status: "ok",
      raw: "0x...",
      decoded: "USDC",
      formatted: "USDC",
    },
    {
      key: "decimals",
      label: "Decimals",
      signature: "decimals()",
      tool: "eth_call",
      status: "ok",
      raw: "0x...",
      decoded: "6",
      formatted: "6 decimals",
    },
    {
      key: "balanceOf",
      label: "Holder balance",
      signature: "balanceOf(address)",
      tool: "eth_call",
      status: "ok",
      raw: "0x...",
      decoded: "525727521263",
      formatted: "525,727.521263 (525,727,521,263 base units) USDC",
      argument: "0x912c9ade24d44d8922f0866d8dcb079f1363f647",
    },
    {
      key: "owner",
      label: "Owner (Ownable, optional)",
      signature: "owner()",
      tool: "eth_call",
      status: "unsupported",
      raw: null,
      decoded: null,
      formatted: null,
      note: "Not implemented by this contract (reverted).",
    },
  ],
  storage: [
    {
      slot: "0x0",
      tool: "get_storage_at",
      raw: `0x${"00".repeat(32)}`,
      status: "ok",
      decoded: { raw: `0x${"00".repeat(32)}`, kind: "empty", value: "0", display: "0 (all 32 bytes zero)" },
    },
  ],
  registry: [
    {
      symbol: "WPROS",
      name: "Wrapped PROS",
      address: "0x52c48D4213107b20bc583832B0d951FB9ca8f0B0",
      note: "Wrapped native PROS",
      decimals: 18,
      totalSupplyRaw: "0x...",
      totalSupplyFormatted: "23,286,546.497604095247685378 WPROS",
      onChainName: "Wrapped PROS",
      onChainSymbol: "WPROS",
      status: "ok",
    },
  ],
  warnings: ["sample warning"],
  mcpToolsUsed: ["eth_call", "get_block", "get_chain_info", "get_code", "get_storage_at"],
};

describe("renderReport", () => {
  const text = renderReport(REPORT);

  it("shows the network, chain ID and contract address up front", () => {
    assert.match(text, /Pharos Pacific Mainnet \(chain ID 1672 \/ 0x688\)/);
    assert.match(text, /0xc879C018dB60520f4355C26ED1A6D572cdac1815/);
    assert.match(text, /https:\/\/mcp\.pharos\.xyz\/mcp/);
  });

  it("shows the block number the data was read at, with a grouped integer", () => {
    assert.match(text, /Read at block {2}20,360,972 {2}\(0x136b0ec\)/);
    assert.match(text, /Block hash {5}0xcdcd/);
  });

  it("renders a value table with statuses and human-readable amounts", () => {
    assert.match(text, /FIELD\s+SOLIDITY\s+MCP TOOL\s+STATUS\s+RAW RESULT\s+HUMAN-READABLE/);
    assert.match(text, /525,727\.521263/);
    assert.match(text, /not implemented/);
  });

  it("lists arguments, storage probes, the registry and the tools used", () => {
    assert.match(text, /Arguments used/);
    assert.match(text, /balanceOf: 0x912c9ade24d44d8922f0866d8dcb079f1363f647/);
    assert.match(text, /Raw storage cross-check/);
    assert.match(text, /0 \(all 32 bytes zero\)/);
    assert.match(text, /Pharos Pacific Mainnet token registry, read at the same block/);
    assert.match(text, /23,286,546\.497604095247685378 WPROS/);
    assert.match(text, /eth_call, get_block, get_chain_info, get_code, get_storage_at/);
  });

  it("shows warnings", () => {
    assert.match(text, /! sample warning/);
  });
});

describe("renderJson", () => {
  it("produces parseable JSON that round-trips the report", () => {
    const parsed = JSON.parse(renderJson(REPORT)) as ContractStateReport;
    assert.equal(parsed.network.chainId, 1672);
    assert.equal(parsed.values.length, 4);
    assert.equal(parsed.mcpToolsUsed.length, 5);
  });
});

describe("summarizeStatus", () => {
  it("counts each status", () => {
    assert.deepEqual(summarizeStatus(REPORT), { ok: 3, unsupported: 1, error: 0 });
  });
});
