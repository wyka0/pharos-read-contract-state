import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { loadDotEnv, parseConfig } from "../src/config.js";
import { InvalidAddressError, InvalidArgumentError } from "../src/errors.js";
import { DEFAULT_HOLDER, PHAROS_NETWORK } from "../src/pharos.js";

describe("parseConfig", () => {
  it("uses documented defaults when nothing is supplied", () => {
    const config = parseConfig([], {});
    assert.equal(config.endpoint, PHAROS_NETWORK.chainMcpEndpoint);
    assert.equal(config.expectedChainId, 1672);
    assert.equal(config.address, "0xC879C018dB60520F4355C26eD1a6D572cdAC1815");
    assert.equal(config.holder, DEFAULT_HOLDER);
    assert.equal(config.block, undefined);
    assert.equal(config.timeoutMs, 20_000);
    assert.equal(config.maxRetries, 2);
    assert.equal(config.readRegistry, true);
    assert.equal(config.json, false);
    assert.equal(config.help, false);
  });

  it("lets CLI flags override environment variables", () => {
    const config = parseConfig(
      ["--address", "0x52c48d4213107b20bc583832b0d951fb9ca8f0b0", "--block", "0x136b0ec", "--no-registry", "--json", "--timeout", "5000", "--retries", "0"],
      { CONTRACT_ADDRESS: "0x1f4b7011Ee3d53969bb67F59428a9ec0477856E9", BLOCK_NUMBER: "123" },
    );
    assert.equal(config.address, "0x52C48d4213107b20bC583832b0d951FB9CA8F0B0");
    assert.equal(config.block, "0x136b0ec");
    assert.equal(config.readRegistry, false);
    assert.equal(config.json, true);
    assert.equal(config.timeoutMs, 5000);
    assert.equal(config.maxRetries, 0);
  });

  it("reads environment variables when no flag is present", () => {
    const config = parseConfig([], {
      CONTRACT_ADDRESS: "0x51e2A24742Db77604B881d6781Ee16B5b8fcBE29",
      HOLDER_ADDRESS: "0x903cf528c0c54ecb99991a69e0e095589917a0ce",
      PHAROS_MCP_ENDPOINT: "https://example.test/mcp",
      PHAROS_CHAIN_ID: "1672",
      BLOCK_NUMBER: "20360972",
      READ_REGISTRY: "0",
    });
    assert.equal(config.address, "0x51e2A24742Db77604B881d6781Ee16B5b8fcBE29");
    assert.equal(config.holder, "0x903cF528c0C54eCB99991a69E0E095589917a0ce");
    assert.equal(config.endpoint, "https://example.test/mcp");
    assert.equal(config.block, "20360972");
    assert.equal(config.readRegistry, false);
  });

  it("rejects a malformed contract address with INVALID_ADDRESS", () => {
    assert.throws(
      () => parseConfig(["--address", "0xnothex"], {}),
      (error: unknown) => error instanceof InvalidAddressError && error.code === "INVALID_ADDRESS",
    );
    assert.throws(() => parseConfig(["--holder", "0x1234"], {}), InvalidAddressError);
  });

  it("rejects unknown flags and missing values", () => {
    assert.throws(
      () => parseConfig(["--nope"], {}),
      (error: unknown) => error instanceof InvalidArgumentError && /Unknown argument/.test(error.message),
    );
    assert.throws(
      () => parseConfig(["--address"], {}),
      (error: unknown) => error instanceof InvalidArgumentError && /requires a value/.test(error.message),
    );
  });

  it("rejects a non-positive timeout and a bad retry count", () => {
    assert.throws(() => parseConfig(["--timeout", "0"], {}), InvalidArgumentError);
    assert.throws(() => parseConfig(["--timeout", "abc"], {}), InvalidArgumentError);
    assert.throws(() => parseConfig(["--retries", "-1"], {}), InvalidArgumentError);
  });

  it("rejects a non-http endpoint", () => {
    assert.throws(
      () => parseConfig(["--endpoint", "ws://example.test"], {}),
      (error: unknown) => error instanceof InvalidArgumentError && /must be an http\(s\) URL/.test(error.message),
    );
  });

  it("recognises --help", () => {
    assert.equal(parseConfig(["--help"], {}).help, true);
    assert.equal(parseConfig(["-h"], {}).help, true);
  });
});

describe("loadDotEnv", () => {
  const directory = mkdtempSync(join(tmpdir(), "pharos-env-"));
  const envPath = join(directory, ".env");
  const addedKeys = ["PHAROS_TEST_ALPHA", "PHAROS_TEST_QUOTED", "PHAROS_TEST_KEEP"];

  after(() => {
    for (const key of addedKeys) delete process.env[key];
    rmSync(directory, { recursive: true, force: true });
  });

  it("loads key/value pairs without overriding existing variables", () => {
    writeFileSync(
      envPath,
      [
        "# a comment",
        "",
        "PHAROS_TEST_ALPHA=from-file",
        'PHAROS_TEST_QUOTED="quoted value"',
        "PHAROS_TEST_KEEP=from-file",
        "IGNORED_LINE_WITHOUT_EQUALS",
      ].join("\n"),
      "utf8",
    );
    process.env.PHAROS_TEST_KEEP = "from-environment";

    loadDotEnv(envPath);

    assert.equal(process.env.PHAROS_TEST_ALPHA, "from-file");
    assert.equal(process.env.PHAROS_TEST_QUOTED, "quoted value");
    assert.equal(process.env.PHAROS_TEST_KEEP, "from-environment");
  });

  it("is a no-op when the file does not exist", () => {
    assert.doesNotThrow(() => loadDotEnv(join(directory, "missing.env")));
  });
});
