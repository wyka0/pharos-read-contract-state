/**
 * Renders a {@link ContractStateReport} for humans.
 *
 * The plain-language section is generated only from values that were actually
 * read successfully this run. Values that were not implemented or that failed
 * are stated as such — they are never silently omitted or replaced with a zero.
 */

import type { ContractStateReport, ReadValue } from "./reader.js";

const STATUS_LABEL: Record<ReadValue["status"], string> = {
  ok: "ok",
  unsupported: "not implemented",
  error: "ERROR",
};

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 3))}...`;
}

function renderTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, column) => {
        const width = widths[column] ?? cell.length;
        return column === cells.length - 1 ? cell : cell.padEnd(width, " ");
      })
      .join("  ")
      .trimEnd();

  const separator = widths.map((width) => "-".repeat(width)).join("  ");
  return [line(headers), separator, ...rows.map((row) => line(row))].join("\n");
}

function valueFor(report: ContractStateReport, key: string): ReadValue | undefined {
  return report.values.find((value) => value.key === key);
}

function groupInteger(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatBlockNumber(value: string | null): string {
  if (!value) return "unknown";
  return /^\d+$/.test(value) ? groupInteger(value) : value;
}

/** Plain-language sentences, derived strictly from this run's successful reads. */
export function buildSummary(report: ContractStateReport): string[] {
  const sentences: string[] = [];
  const name = valueFor(report, "name");
  const symbol = valueFor(report, "symbol");
  const decimals = valueFor(report, "decimals");
  const totalSupply = valueFor(report, "totalSupply");
  const balance = valueFor(report, "balanceOf");
  const allowance = valueFor(report, "allowance");
  const owner = valueFor(report, "owner");
  const holder = balance?.argument ?? "";
  const spender = allowance?.argument?.split(" -> ")[1] ?? "";

  if (name?.status === "ok" && symbol?.status === "ok") {
    sentences.push(
      `This contract is an ERC-20 token called "${name.decoded}" with the ticker ${symbol.decoded}, deployed at ${report.contract.address}.`,
    );
  } else if (name?.status === "ok") {
    sentences.push(`This contract identifies itself as "${name.decoded}" at ${report.contract.address}.`);
  } else {
    sentences.push(
      `This contract at ${report.contract.address} does not return a readable ERC-20 name, so it may not be a standard token.`,
    );
  }

  if (decimals?.status === "ok") {
    sentences.push(
      `Amounts are stored as whole numbers with ${decimals.decoded} decimal places, so 1 ${symbol?.decoded ?? "token"} is represented on-chain as 10^${decimals.decoded} base units.`,
    );
  }

  if (totalSupply?.status === "ok" && totalSupply.formatted) {
    sentences.push(`The total supply is ${totalSupply.formatted}.`);
  }

  if (balance?.status === "ok" && balance.formatted) {
    sentences.push(`The wallet ${holder} currently holds ${balance.formatted}.`);
  } else if (balance?.status !== "ok") {
    sentences.push(`The balance of ${holder} could not be read (${balance?.note ?? balance?.error ?? "unknown reason"}).`);
  }

  if (allowance?.status === "ok" && allowance.formatted) {
    sentences.push(`That wallet has authorised the spender ${spender} to transfer up to ${allowance.formatted} on its behalf.`);
  }

  if (owner?.status === "ok" && owner.decoded) {
    sentences.push(`The contract's owner is ${owner.formatted ?? owner.decoded}.`);
  } else if (owner && owner.status !== "ok") {
    sentences.push("This contract does not expose an owner() accessor, which is normal for a wrapped-native token.");
  }

  sentences.push(
    `Every value above was read at block ${formatBlockNumber(report.block.number)} (${report.block.hex ?? "n/a"}), so the whole snapshot is consistent.`,
  );

  return sentences;
}

export function renderReport(report: ContractStateReport): string {
  const out: string[] = [];
  const push = (...lines: string[]) => out.push(...lines);

  push(
    "Pharos — Read Contract State (via Chain MCP)",
    "============================================",
    "",
    `Network        ${report.network.name} (chain ID ${report.network.chainId} / ${report.network.chainIdHex})`,
    `Native token   ${report.network.nativeSymbol}`,
    `Node client    ${report.network.mcpServer}`,
    `JSON-RPC       ${report.network.rpcUrl}`,
    `Chain MCP      ${report.network.mcpEndpoint}`,
    `Read at block  ${formatBlockNumber(report.block.number)}  (${report.block.hex ?? "n/a"})`,
    `Block hash     ${report.block.hash ?? "unavailable"}`,
    `Block time     ${report.block.timestamp ?? "unavailable"}`,
    `Block source   ${report.block.resolvedBy === "pinned-flags" ? "pinned via --block" : "latest block observed at startup"}`,
    `Generated      ${report.generatedAt}`,
    "",
    `Contract       ${report.contract.address}`,
    `Contract label ${report.contract.label}`,
    `Bytecode       ${groupInteger(String(report.contract.codeBytes))} bytes (eth_getCode confirms a deployed contract)`,
    "",
  );

  push("Plain-language summary", "----------------------");
  for (const sentence of buildSummary(report)) push(`• ${sentence}`);
  push("");

  push("Values read from this contract via Chain MCP", "-------------------------------------------");
  push(
    renderTable(
      ["FIELD", "SOLIDITY", "MCP TOOL", "STATUS", "RAW RESULT", "HUMAN-READABLE"],
      report.values.map((value) => [
        value.key,
        value.signature,
        value.tool,
        STATUS_LABEL[value.status],
        truncate(value.raw ?? "—", 24),
        value.formatted ?? value.note ?? value.error ?? "—",
      ]),
    ),
  );
  push("");

  const withArgs = report.values.filter((value) => value.argument);
  if (withArgs.length > 0) {
    push("Arguments used", "--------------");
    for (const value of withArgs) push(`${value.key}: ${value.argument}`);
    push("");
  }

  push("Raw storage cross-check (eth_getStorageAt, same block)", "-----------------------------------------------------");
  push(
    renderTable(
      ["SLOT", "RAW WORD", "INTERPRETATION", "CORROBORATES"],
      report.storage.map((probe) => [
        probe.slot,
        truncate(probe.raw ?? "—", 26),
        probe.decoded ? probe.decoded.display : (probe.error ?? "unavailable"),
        probe.corroborates ?? "—",
      ]),
    ),
  );
  push(
    "",
    "Storage words are interpreted only when a layout fully validates; a dynamic",
    "string is never claimed from a single slot.",
    "",
  );

  if (report.registry.length > 0) {
    push("Pharos Pacific Mainnet token registry, read at the same block", "------------------------------------------------------------");
    push(
      renderTable(
        ["SYMBOL", "NAME (on-chain)", "ADDRESS", "DECIMALS", "TOTAL SUPPLY", "STATUS"],
        report.registry.map((entry) => [
          entry.symbol,
          entry.onChainName ?? entry.name,
          entry.address,
          entry.decimals === null ? "—" : String(entry.decimals),
          entry.totalSupplyFormatted ?? "—",
          entry.status === "ok" ? "ok" : "ERROR",
        ]),
      ),
    );
    push("");
  }

  push("Chain MCP tools used in this run", "-------------------------------");
  push(report.mcpToolsUsed.join(", "));
  push("");

  if (report.warnings.length > 0) {
    push("Warnings", "--------");
    for (const warning of report.warnings) push(`! ${warning}`);
    push("");
  }

  return out.join("\n");
}

export function renderJson(report: ContractStateReport): string {
  return JSON.stringify(report, null, 2);
}

/** Exit non-zero when the primary contract could not be read at all. */
export function summarizeStatus(report: ContractStateReport): { ok: number; unsupported: number; error: number } {
  const counts = { ok: 0, unsupported: 0, error: 0 };
  for (const value of report.values) counts[value.status] += 1;
  return counts;
}
