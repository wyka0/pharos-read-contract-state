#!/usr/bin/env node
/**
 * Live verification against the real Pharos Chain MCP endpoint.
 *
 * Unlike the unit tests under `test/*.test.ts`, this script performs genuine
 * network reads against https://mcp.pharos.xyz/mcp. It is intentionally NOT
 * named `*.test.ts` so that `npm test` stays deterministic and offline; run it
 * with `npm run test:live`.
 *
 * It exits non-zero if any of the task's guarantees cannot be demonstrated.
 */

import assert from "node:assert/strict";

import { loadDotEnv, parseConfig } from "../src/config.js";
import { PharosChainMcp } from "../src/mcp/chainMcp.js";
import { PHAROS_NETWORK } from "../src/pharos.js";
import { readContractState } from "../src/reader.js";
import { renderReport, summarizeStatus } from "../src/report.js";

async function main(): Promise<void> {
  loadDotEnv();
  const config = parseConfig(process.argv.slice(2));
  if (config.help) {
    process.stdout.write("Usage: npm run test:live [-- options]\n\n" + "Runs real reads against the Pharos Chain MCP endpoint.\n");
    return;
  }
  const chain = PharosChainMcp.fromEndpoint(config.endpoint, {
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
  });

  try {
    const report = await readContractState(chain, {
      address: config.address,
      holder: config.holder,
      spender: config.spender,
      block: config.block,
      expectedChainId: config.expectedChainId,
      readRegistry: config.readRegistry,
    });

    process.stdout.write(`${renderReport(report)}\n`);

    const counts = summarizeStatus(report);
    const okValues = report.values.filter((value) => value.status === "ok");

    // --- Live assertions -----------------------------------------------------
    assert.equal(report.network.chainId, PHAROS_NETWORK.chainId, "must be reading Pharos Pacific Mainnet");
    assert.equal(report.contract.isContract, true, "the target address must be a deployed contract");
    assert.ok(okValues.length >= 3, `expected >= 3 live values, got ${okValues.length}`);
    assert.equal(counts.error, 0, "no read may fail");

    const name = report.values.find((value) => value.key === "name");
    const symbol = report.values.find((value) => value.key === "symbol");
    const decimals = report.values.find((value) => value.key === "decimals");
    const totalSupply = report.values.find((value) => value.key === "totalSupply");
    const balance = report.values.find((value) => value.key === "balanceOf");

    assert.ok(name?.decoded, "name() must return a readable string");
    assert.ok(symbol?.decoded, "symbol() must return a readable string");
    assert.ok(Number(decimals?.decoded) >= 0, "decimals() must return a number");
    assert.ok(BigInt(totalSupply?.decoded ?? "-1") > 0n, "totalSupply() must be positive");
    assert.ok(BigInt(balance?.decoded ?? "-1") >= 0n, "balanceOf() must be non-negative");

    assert.ok(report.block.number !== null && /^\d+$/.test(report.block.number), "a numeric block must be reported");
    assert.ok(BigInt(report.block.number) > 0n, "block number must be positive");
    assert.match(report.block.hash ?? "", /^0x[0-9a-f]{64}$/, "block hash must be reported");
    assert.ok(report.storage.some((probe) => probe.status === "ok"), "raw storage read must succeed");
    assert.ok(report.mcpToolsUsed.includes("eth_call"), "eth_call must be used");
    assert.ok(report.mcpToolsUsed.includes("get_chain_info"), "get_chain_info must be used");

    for (const token of report.registry) {
      assert.equal(token.status, "ok", `registry token ${token.symbol} must read cleanly`);
      assert.ok(token.decimals !== null, `registry token ${token.symbol} must expose decimals`);
    }

    // Compact, copy-pasteable evidence block for the README / submission.
    const evidence = {
      network: report.network.name,
      chainId: report.network.chainId,
      contract: report.contract.address,
      contractLabel: report.contract.label,
      block: report.block.number,
      blockHash: report.block.hash,
      generatedAt: report.generatedAt,
      mcpToolsUsed: report.mcpToolsUsed,
      values: report.values.map((value) => ({
        key: value.key,
        status: value.status,
        raw: value.raw,
        decoded: value.decoded,
        formatted: value.formatted,
      })),
      storage: report.storage.map((probe) => ({
        slot: probe.slot,
        raw: probe.raw,
        interpretation: probe.decoded?.display ?? null,
        corroborates: probe.corroborates ?? null,
      })),
      registry: report.registry.map((token) => ({
        symbol: token.symbol,
        onChainName: token.onChainName,
        decimals: token.decimals,
        totalSupply: token.totalSupplyFormatted,
      })),
    };

    process.stdout.write("\n--- LIVE EVIDENCE (JSON) ---\n");
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write(`\nLive check passed: ${okValues.length} values read at block ${report.block.number}.\n`);
  } finally {
    await chain.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`\nLive check FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
