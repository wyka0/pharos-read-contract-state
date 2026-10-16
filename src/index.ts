#!/usr/bin/env node
/**
 * CLI entry point.
 *
 * Reads live state from a deployed Pharos contract through Chain MCP and prints
 * a human-readable report (or JSON with `--json`).
 *
 * Exit codes:
 *   0  success — at least three values read, no read errors
 *   1  the run failed (transport, chain mismatch, not a contract, or a read error)
 *   2  invalid arguments
 */

import { PharosChainMcp } from "./mcp/chainMcp.js";
import { HELP_TEXT, loadDotEnv, parseConfig } from "./config.js";
import { InvalidAddressError, InvalidArgumentError, PharosError } from "./errors.js";
import { readContractState } from "./reader.js";
import { renderJson, renderReport, summarizeStatus } from "./report.js";

async function main(): Promise<number> {
  loadDotEnv();

  let config;
  try {
    config = parseConfig(process.argv.slice(2));
  } catch (error) {
    // Anything the user supplied that could not be parsed is a usage error,
    // whether it was a malformed flag or a malformed address.
    if (error instanceof InvalidArgumentError || error instanceof InvalidAddressError) {
      process.stderr.write(`Argument error: ${error.message}\n\n${HELP_TEXT}\n`);
      return 2;
    }
    throw error;
  }

  if (config.help) {
    process.stdout.write(`${HELP_TEXT}\n`);
    return 0;
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

    process.stdout.write(config.json ? `${renderJson(report)}\n` : `${renderReport(report)}\n`);

    const counts = summarizeStatus(report);
    if (counts.error > 0) {
      process.stderr.write(`Completed with ${counts.error} failed read(s). See the report above.\n`);
      return 1;
    }
    if (counts.ok < 3) {
      process.stderr.write(`Only ${counts.ok} value(s) were read successfully; the task requires at least three.\n`);
      return 1;
    }
    return 0;
  } finally {
    await chain.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof PharosError) {
      process.stderr.write(`\n[${error.code}] ${error.message}\n`);
      if (error.code === "MCP_TRANSPORT" || error.code === "MCP_RATE_LIMIT") {
        process.stderr.write(
          "\nThe Chain MCP endpoint could not be reached. Check connectivity to " +
            "https://mcp.pharos.xyz/mcp, or point --endpoint at another MCP server.\n",
        );
      }
    } else {
      process.stderr.write(`\nUnexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    }
    process.exitCode = 1;
  });
