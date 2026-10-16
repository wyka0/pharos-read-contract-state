import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeAbiParameters } from "viem";

import { encodeReadCall } from "../src/chain/erc20.js";
import { ChainMismatchError, PharosError } from "../src/errors.js";
import { StreamableHttpMcpClient } from "../src/mcp/client.js";
import { PharosChainMcp } from "../src/mcp/chainMcp.js";
import { readContractState, type ContractStateReport, type ReadContractOptions } from "../src/reader.js";
import { buildSummary } from "../src/report.js";
import type { RegistryToken } from "../src/pharos.js";
import { FakeChainMcpServer, type FakeToolHandler } from "./helpers/fakeMcp.js";

const ENDPOINT = "https://mcp.example.test/mcp";
const USDC = "0xC879C018dB60520F4355C26eD1a6D572cdAC1815" as const;
const HOLDER = "0x912c9aDe24D44d8922f0866D8Dcb079f1363f647" as const;
const SPENDER = "0xf38d34c8382b9079b0f85309578b43b8479Cd875" as const;
/** Fixture bytecode: 5 bytes of real Solidity prologue plus padding. */
const CONTRACT_CODE = `0x6080604052${"ab".repeat(64)}`;
const CODE_BYTES = (CONTRACT_CODE.length - 2) / 2;
const BLOCK_NUMBER_HEX = "0x136af0c";
const BLOCK_NUMBER_DECIMAL = "20360972";

const uint = (value: bigint) => encodeAbiParameters([{ type: "uint256" }], [value]);
const str = (value: string) => encodeAbiParameters([{ type: "string" }], [value]);
const addr = (value: `0x${string}`) => encodeAbiParameters([{ type: "address" }], [value]);

interface Fixture {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  balance: bigint;
  allowance: bigint;
  /** Either an address the contract returns, or "revert" for a contract without owner(). */
  owner: `0x${string}` | "revert";
  /** Raw storage words keyed by slot number; 0 is returned when absent. */
  storage?: Record<number, string>;
}

const USDC_FIXTURE: Fixture = {
  name: "USDC",
  symbol: "USDC",
  decimals: 6,
  totalSupply: 24_383_535_246_820n,
  balance: 525_727_521_263n,
  allowance: 0n,
  owner: "revert",
};

/**
 * WPROS fixture. The storage words are the real packed WETH9-layout words
 * captured from the live contract, so the corroboration path is exercised
 * against genuine on-chain bytes.
 */
const WPROS_FIXTURE: Fixture = {
  name: "Wrapped PROS",
  symbol: "WPROS",
  decimals: 18,
  totalSupply: 23_286_546_497_604_095_247_685_378n,
  balance: 5_000n,
  allowance: 1_000n,
  owner: "0x9F8Ea09770Dc38fc61f5a62031b3BE0526D54D92",
  storage: {
    0: "0x577261707065642050524f530000000000000000000000000000000000000018",
    1: "0x5750524f5300000000000000000000000000000000000000000000000000000a",
    2: "0x0000000000000000000000000000000000000000000000000000000000000012",
  },
};

const REVERTED = { data: { error: { code: -32000, message: "execution reverted" } }, isError: true };

function chainInfoHandler(chainId: number, latestBlock: string): FakeToolHandler {
  return () => ({
    data: {
      name: "Pharos",
      chainId,
      chainIdHex: `0x${chainId.toString(16)}`,
      expectedChainId: 1672,
      chainIdMatches: chainId === 1672,
      latestBlock,
      latestBlockHex: `0x${Number(latestBlock).toString(16)}`,
      nativeSymbol: "PROS",
      clientVersion: "portal/1.0.0",
      rpcUrl: "https://rpc.pharos.xyz",
    },
  });
}

function buildHandlers(fixture: Fixture, overrides: { chainId?: number; latestBlock?: string; code?: string; registryTokens?: RegistryToken[] } = {}) {
  const ethCall: FakeToolHandler = ({ transaction }) => {
    const data = String((transaction as { data?: string } | undefined)?.data ?? "");
    const is = (method: Parameters<typeof encodeReadCall>[0]) => data === encodeReadCall(method);

    if (is({ method: "name" })) return { data: { result: str(fixture.name) } };
    if (is({ method: "symbol" })) return { data: { result: str(fixture.symbol) } };
    if (is({ method: "decimals" })) return { data: { result: uint(BigInt(fixture.decimals)) } };
    if (is({ method: "totalSupply" })) return { data: { result: uint(fixture.totalSupply) } };
    if (is({ method: "balanceOf", account: HOLDER })) return { data: { result: uint(fixture.balance) } };
    if (is({ method: "allowance", owner: HOLDER, spender: SPENDER })) return { data: { result: uint(fixture.allowance) } };
    if (is({ method: "owner" })) {
      return fixture.owner === "revert" ? REVERTED : { data: { result: addr(fixture.owner) } };
    }
    return REVERTED;
  };

  const handlers: Record<string, FakeToolHandler> = {
    get_chain_info: chainInfoHandler(overrides.chainId ?? 1672, overrides.latestBlock ?? BLOCK_NUMBER_DECIMAL),
    get_code: () => ({ data: { code: overrides.code ?? CONTRACT_CODE } }),
    eth_call: ethCall,
    get_storage_at: ({ position }) => {
      const slot = Number(BigInt(String(position)));
      return { data: { value: fixture.storage?.[slot] ?? `0x${"0".repeat(64)}` } };
    },
    get_block: () => ({ data: { number: BLOCK_NUMBER_HEX, hash: `0x${"cd".repeat(32)}`, timestamp: "0x68f0a1c0" } }),
  };

  return handlers;
}

function buildServer(fixture: Fixture, overrides: Parameters<typeof buildHandlers>[1] = {}) {
  const handlers = buildHandlers(fixture, overrides);
  return new FakeChainMcpServer({ handlers, toolNames: Object.keys(handlers) });
}

async function run(fixture: Fixture, server: FakeChainMcpServer, options: Partial<ReadContractOptions> = {}) {
  const chain = new PharosChainMcp(new StreamableHttpMcpClient({ endpoint: ENDPOINT, fetchImpl: server.fetch }));
  return readContractState(chain, {
    address: USDC,
    holder: HOLDER,
    spender: SPENDER,
    expectedChainId: 1672,
    readRegistry: false,
    ...options,
  });
}

function valueOf(report: ContractStateReport, key: string) {
  const value = report.values.find((entry) => entry.key === key);
  assert.ok(value, `expected a value named ${key}`);
  return value;
}

describe("readContractState", () => {
  it("reads at least three distinct values over Chain MCP", async () => {
    const report = await run(USDC_FIXTURE, buildServer(USDC_FIXTURE));
    const ok = report.values.filter((value) => value.status === "ok");
    assert.ok(ok.length >= 3, `expected >= 3 successful reads, got ${ok.length}`);
    assert.deepEqual(
      ok.map((value) => value.key).sort(),
      ["allowance", "balanceOf", "decimals", "name", "symbol", "totalSupply"],
    );
  });

  it("reports the network, chain ID and contract address", async () => {
    const report = await run(USDC_FIXTURE, buildServer(USDC_FIXTURE));
    assert.equal(report.network.chainId, 1672);
    assert.equal(report.network.chainIdHex, "0x688");
    assert.equal(report.network.nativeSymbol, "PROS");
    assert.equal(report.network.mcpEndpoint, ENDPOINT);
    assert.equal(report.contract.address, USDC);
    assert.equal(report.contract.isContract, true);
    assert.equal(report.contract.codeBytes, CODE_BYTES);
  });

  it("pins every read to a single block and reports it", async () => {
    const server = buildServer(USDC_FIXTURE);
    const report = await run(USDC_FIXTURE, server, { block: BLOCK_NUMBER_HEX });

    assert.equal(report.block.requested, BLOCK_NUMBER_HEX);
    assert.equal(report.block.resolvedBy, "pinned-flags");
    assert.equal(report.block.number, String(BigInt(BLOCK_NUMBER_HEX)));
    assert.equal(report.block.hash, `0x${"cd".repeat(32)}`);

    const blockScoped = server.requests.filter((request) =>
      ["eth_call", "get_code", "get_storage_at"].includes(request.toolName ?? ""),
    );
    assert.ok(blockScoped.length > 0);
    for (const request of blockScoped) {
      assert.equal(request.args?.block, BLOCK_NUMBER_HEX, `${request.toolName} must be pinned to the requested block`);
    }
  });

  it("defaults to the latest block observed at startup", async () => {
    const report = await run(USDC_FIXTURE, buildServer(USDC_FIXTURE));
    assert.equal(report.block.resolvedBy, "latest-at-startup");
    assert.equal(report.block.requested, BLOCK_NUMBER_DECIMAL);
  });

  it("keeps the raw hex result alongside decoded and human-readable forms", async () => {
    const report = await run(USDC_FIXTURE, buildServer(USDC_FIXTURE));

    const supply = valueOf(report, "totalSupply");
    assert.equal(supply.tool, "eth_call");
    assert.equal(supply.raw, uint(24_383_535_246_820n));
    assert.equal(supply.decoded, "24383535246820");
    assert.equal(supply.formatted, "24,383,535.24682 (24,383,535,246,820 base units) USDC");

    const balance = valueOf(report, "balanceOf");
    assert.equal(balance.decoded, "525727521263");
    assert.equal(balance.formatted, "525,727.521263 (525,727,521,263 base units) USDC");
    assert.equal(balance.argument, HOLDER);
  });

  it("applies the correct decimals per contract", async () => {
    const usdc = await run(USDC_FIXTURE, buildServer(USDC_FIXTURE));
    assert.equal(valueOf(usdc, "decimals").decoded, "6");

    const wpros = await run(WPROS_FIXTURE, buildServer(WPROS_FIXTURE));
    assert.equal(valueOf(wpros, "decimals").decoded, "18");
    assert.match(valueOf(wpros, "balanceOf").formatted ?? "", /0\.000000000000005 \(5,000 base units\) WPROS/);
  });

  it("reports an unimplemented optional method as unsupported rather than crashing", async () => {
    const report = await run(USDC_FIXTURE, buildServer(USDC_FIXTURE));
    const owner = valueOf(report, "owner");
    assert.equal(owner.status, "unsupported");
    assert.match(owner.note ?? "", /Not implemented by this contract/);
    assert.equal(report.values.filter((value) => value.status === "error").length, 0);
  });

  it("reads owner() when the contract implements it", async () => {
    const report = await run(WPROS_FIXTURE, buildServer(WPROS_FIXTURE));
    const owner = valueOf(report, "owner");
    assert.equal(owner.status, "ok", owner.error ?? owner.note ?? "no detail");
    assert.equal(owner.decoded, "0x9F8Ea09770Dc38fc61f5a62031b3BE0526D54D92");
  });

  it("corroborates view calls against raw storage when the layout matches", async () => {
    const report = await run(WPROS_FIXTURE, buildServer(WPROS_FIXTURE));
    const slot0 = report.storage.find((probe) => probe.slot === "0x0");
    const slot1 = report.storage.find((probe) => probe.slot === "0x1");
    const slot2 = report.storage.find((probe) => probe.slot === "0x2");

    assert.equal(slot0?.decoded?.text, "Wrapped PROS");
    assert.equal(slot0?.corroborates, "name() view call");
    assert.equal(slot1?.corroborates, "symbol() view call");
    assert.equal(slot2?.decoded?.value, "18");
    assert.equal(slot2?.corroborates, "decimals() view call");
  });

  it("does not claim corroboration when the storage layout does not match", async () => {
    const report = await run(USDC_FIXTURE, buildServer(USDC_FIXTURE));
    for (const probe of report.storage) {
      assert.equal(probe.status, "ok");
      assert.equal(probe.corroborates, undefined, `slot ${probe.slot} must not claim corroboration`);
    }
  });

  it("records which Chain MCP tools were used", async () => {
    const report = await run(USDC_FIXTURE, buildServer(USDC_FIXTURE));
    assert.deepEqual(report.mcpToolsUsed, ["eth_call", "get_block", "get_chain_info", "get_code", "get_storage_at"]);
  });

  it("aborts on a chain ID mismatch instead of reporting foreign data", async () => {
    const server = buildServer(USDC_FIXTURE, { chainId: 1 });
    await assert.rejects(
      () => run(USDC_FIXTURE, server),
      (error: unknown) => error instanceof ChainMismatchError && /Expected Pharos chain ID 1672/.test(error.message),
    );
  });

  it("fails clearly when the address is not a deployed contract", async () => {
    const server = buildServer(USDC_FIXTURE, { code: "0x" });
    await assert.rejects(
      () => run(USDC_FIXTURE, server),
      (error: unknown) => error instanceof PharosError && error.code === "NOT_A_CONTRACT",
    );
  });

  it("surfaces a tool failure as an error row without losing the other reads", async () => {
    const handlers = buildHandlers(USDC_FIXTURE);
    const goodEthCall = handlers.eth_call;
    assert.ok(goodEthCall);
    handlers.eth_call = (args) => {
      const data = String((args.transaction as { data?: string } | undefined)?.data ?? "");
      if (data === encodeReadCall({ method: "totalSupply" })) {
        return { data: { error: { code: -32000, message: "upstream timeout while reading totalSupply" } }, isError: true };
      }
      return goodEthCall(args);
    };

    const report = await run(USDC_FIXTURE, new FakeChainMcpServer({ handlers }));

    const supply = valueOf(report, "totalSupply");
    assert.equal(supply.status, "error");
    assert.match(supply.error ?? "", /upstream timeout/);
    assert.equal(valueOf(report, "balanceOf").status, "ok");
    assert.equal(valueOf(report, "name").status, "ok");
  });

  it("sweeps registry tokens at the same pinned block", async () => {
    const token: RegistryToken = {
      symbol: "TST",
      name: "Test Token",
      address: "0x1f4b7011Ee3d53969bb67F59428a9ec0477856E9",
      decimals: 8,
      note: "fixture",
    };
    let lastData = "";
    const handlers = buildHandlers(USDC_FIXTURE);
    const inner = handlers.eth_call;
    assert.ok(inner);
    handlers.eth_call = (args) => {
      const to = String((args.transaction as { to?: string } | undefined)?.to ?? "").toLowerCase();
      if (to === token.address.toLowerCase()) {
        lastData = String((args.transaction as { data?: string } | undefined)?.data ?? "");
        if (lastData === encodeReadCall({ method: "name" })) return { data: { result: str("Test Token") } };
        if (lastData === encodeReadCall({ method: "symbol" })) return { data: { result: str("TST") } };
        if (lastData === encodeReadCall({ method: "decimals" })) return { data: { result: uint(8n) } };
        if (lastData === encodeReadCall({ method: "totalSupply" })) return { data: { result: uint(123_456_789n) } };
      }
      return inner(args);
    };

    const server = new FakeChainMcpServer({ handlers });
    const report = await run(USDC_FIXTURE, server, { readRegistry: true, registry: [token], block: BLOCK_NUMBER_HEX });

    assert.equal(report.registry.length, 1);
    const entry = report.registry[0];
    assert.ok(entry);
    assert.equal(entry.status, "ok");
    assert.equal(entry.decimals, 8);
    assert.equal(entry.onChainName, "Test Token");
    assert.equal(entry.totalSupplyFormatted, "1.23456789 TST");

    const registryCalls = server.requests.filter(
      (request) =>
        request.toolName === "eth_call" &&
        String((request.args?.transaction as { to?: string } | undefined)?.to ?? "").toLowerCase() ===
          token.address.toLowerCase(),
    );
    assert.ok(registryCalls.length >= 4);
    for (const request of registryCalls) assert.equal(request.args?.block, BLOCK_NUMBER_HEX);
  });
});

describe("buildSummary", () => {
  it("describes the values that were actually read", async () => {
    const report = await run(USDC_FIXTURE, buildServer(USDC_FIXTURE));
    const summary = buildSummary(report).join(" ");
    assert.match(summary, /ERC-20 token called "USDC" with the ticker USDC/);
    assert.match(summary, /6 decimal places/);
    assert.match(summary, /total supply is 24,383,535\.24682/);
    assert.match(summary, /holds 525,727\.521263/);
    assert.match(summary, /block 20,360,972/);
  });

  it("states that an unimplemented accessor is absent instead of inventing an owner", async () => {
    const report = await run(USDC_FIXTURE, buildServer(USDC_FIXTURE));
    const summary = buildSummary(report).join(" ");
    assert.match(summary, /does not expose an owner\(\) accessor/);
    assert.doesNotMatch(summary, /owner is/i);
  });
});
