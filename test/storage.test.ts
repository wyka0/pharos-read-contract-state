import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decodeStorageWord, matchesViewValue } from "../src/chain/storage.js";

/**
 * These three words are the actual `eth_getStorageAt` responses for the WPROS
 * contract (0x52c48d4213107b20bc583832b0d951fb9ca8f0b0) on Pharos Pacific
 * Mainnet, captured during development. They exercise the WETH9 packed
 * short-string layout.
 */
const WPROS_SLOT0 = "0x577261707065642050524f530000000000000000000000000000000000000018";
const WPROS_SLOT1 = "0x5750524f5300000000000000000000000000000000000000000000000000000a";
const WPROS_SLOT2 = "0x0000000000000000000000000000000000000000000000000000000000000012";

describe("decodeStorageWord", () => {
  it("decodes a WETH9 packed short string", () => {
    const word = decodeStorageWord(WPROS_SLOT0);
    assert.equal(word.kind, "short-string");
    assert.equal(word.text, "Wrapped PROS");
    assert.match(word.display, /Wrapped PROS/);
  });

  it("decodes the symbol slot", () => {
    const word = decodeStorageWord(WPROS_SLOT1);
    assert.equal(word.kind, "short-string");
    assert.equal(word.text, "WPROS");
  });

  it("decodes a plain integer slot and does not mistake it for a string", () => {
    const word = decodeStorageWord(WPROS_SLOT2);
    assert.equal(word.kind, "uint256");
    assert.equal(word.value, "18");
  });

  it("reports an all-zero word as empty", () => {
    const word = decodeStorageWord(`0x${"0".repeat(64)}`);
    assert.equal(word.kind, "empty");
    assert.equal(word.value, "0");
  });

  it("does not claim a dynamic string from a single slot", () => {
    // 0x20 is the ABI offset of a dynamic string; its data lives elsewhere.
    const word = decodeStorageWord(`0x${"0".repeat(62)}20`);
    assert.equal(word.kind, "uint256");
    assert.equal(word.value, "32");
    assert.equal(word.text, undefined);
  });

  it("rejects a word that is not 32 bytes", () => {
    const word = decodeStorageWord("0x1234");
    assert.equal(word.kind, "empty");
    assert.match(word.display, /not a 32-byte word/);
  });

  it("offers an address candidate only when the leading bytes are zero", () => {
    const word = decodeStorageWord(`0x000000000000000000000000${"9f8ea09770dc38fc61f5a62031b3be0526d54d92"}`);
    assert.equal(word.kind, "uint256");
    assert.equal(word.addressCandidate, "0x9F8Ea09770Dc38fc61f5a62031b3BE0526D54D92");
  });
});

describe("matchesViewValue", () => {
  it("corroborates a view call with the matching storage layout", () => {
    assert.equal(matchesViewValue(decodeStorageWord(WPROS_SLOT0), "Wrapped PROS"), true);
    assert.equal(matchesViewValue(decodeStorageWord(WPROS_SLOT1), "WPROS"), true);
    assert.equal(matchesViewValue(decodeStorageWord(WPROS_SLOT2), 18), true);
  });

  it("does not corroborate a mismatched value", () => {
    assert.equal(matchesViewValue(decodeStorageWord(WPROS_SLOT0), "USDC"), false);
    assert.equal(matchesViewValue(decodeStorageWord(WPROS_SLOT2), 6), false);
    assert.equal(matchesViewValue(decodeStorageWord(WPROS_SLOT0), null), false);
  });
});
