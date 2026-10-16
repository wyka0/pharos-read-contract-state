import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeAbiParameters } from "viem";

import {
  decodeReadResult,
  encodeReadCall,
  formatTokenAmount,
  groupDigits,
  isEmptyResult,
  isZeroAddress,
  normalizeAddress,
} from "../src/chain/erc20.js";
import { InvalidAddressError } from "../src/errors.js";

const HOLDER = "0x912c9ade24d44d8922f0866d8dcb079f1363f647" as const;
const SPENDER = "0xf38d34c8382b9079b0f85309578b43b8479cd875" as const;

describe("encodeReadCall", () => {
  // Keccak-256 selectors of the canonical signatures. These are constants of the
  // ABI, not values read from any chain.
  it("emits the canonical 4-byte selector for each ERC-20 getter", () => {
    assert.equal(encodeReadCall({ method: "name" }), "0x06fdde03");
    assert.equal(encodeReadCall({ method: "symbol" }), "0x95d89b41");
    assert.equal(encodeReadCall({ method: "decimals" }), "0x313ce567");
    assert.equal(encodeReadCall({ method: "totalSupply" }), "0x18160ddd");
    assert.equal(encodeReadCall({ method: "owner" }), "0x8da5cb5b");
  });

  it("ABI-encodes the arguments of balanceOf and allowance", () => {
    assert.equal(encodeReadCall({ method: "balanceOf", account: HOLDER }), `0x70a08231${HOLDER.slice(2).padStart(64, "0")}`);
    assert.equal(
      encodeReadCall({ method: "allowance", owner: HOLDER, spender: SPENDER }),
      `0xdd62ed3e${HOLDER.slice(2).padStart(64, "0")}${SPENDER.slice(2).padStart(64, "0")}`,
    );
  });
});

describe("decodeReadResult", () => {
  it("decodes a string return", () => {
    const encoded = encodeAbiParameters([{ type: "string" }], ["USD Coin"]);
    assert.equal(decodeReadResult({ method: "name" }, encoded), "USD Coin");
  });

  it("decodes uint8 and uint256 returns", () => {
    assert.equal(decodeReadResult({ method: "decimals" }, encodeAbiParameters([{ type: "uint8" }], [6])), 6);
    assert.equal(
      decodeReadResult({ method: "totalSupply" }, encodeAbiParameters([{ type: "uint256" }], [24_383_535_246_820n])),
      24_383_535_246_820n,
    );
  });

  it("decodes an address return", () => {
    const encoded = encodeAbiParameters([{ type: "address" }], ["0x9f8ea09770dc38fc61f5a62031b3be0526d54d92"]);
    assert.equal(decodeReadResult({ method: "owner" }, encoded), "0x9F8Ea09770Dc38fc61f5a62031b3BE0526D54D92");
  });

  it("throws for a truncated return value", () => {
    assert.throws(() => decodeReadResult({ method: "decimals" }, "0x01"), /^Error|Error/);
  });
});

describe("formatTokenAmount", () => {
  it("applies 6 decimals and groups the integer part", () => {
    assert.equal(formatTokenAmount(525_727_521_263n, 6), "525,727.521263");
    assert.equal(formatTokenAmount(24_383_535_246_820n, 6), "24,383,535.24682");
  });

  it("applies 18 decimals", () => {
    assert.equal(formatTokenAmount(1_000_000_000_000_000_000n, 18), "1");
    assert.equal(formatTokenAmount(1_500_000_000_000_000_000n, 18), "1.5");
  });

  it("keeps full precision instead of rounding", () => {
    assert.equal(formatTokenAmount(1n, 18), "0.000000000000000001");
  });

  it("handles zero", () => {
    assert.equal(formatTokenAmount(0n, 6), "0");
  });
});

describe("groupDigits", () => {
  it("groups thousands", () => {
    assert.equal(groupDigits("20360972"), "20,360,972");
  });
});

describe("normalizeAddress", () => {
  it("checksums a lowercase address", () => {
    assert.equal(normalizeAddress("0xc879c018db60520f4355c26ed1a6d572cdac1815"), "0xC879C018dB60520F4355C26eD1a6D572cdAC1815");
  });

  it("matches the official EIP-55 checksum test vectors", () => {
    // https://eips.ethereum.org/EIPS/eip-55
    const vectors: Array<[string, string]> = [
      ["0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed", "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"],
      ["0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359", "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359"],
      ["0xdbf03b407c01e7cd3cbea99509d93f8dddc8c6fb", "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB"],
      ["0xd1220a0cf47c7b9be7a2e6ba89f429762e7b9adb", "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb"],
    ];
    for (const [input, expected] of vectors) {
      assert.equal(normalizeAddress(input), expected, `EIP-55 vector ${input}`);
    }
  });

  it("rechecksums a mixed-case address whose EIP-55 checksum is wrong", () => {
    // A common copy-paste artefact: valid hex, invalid checksum casing.
    assert.equal(normalizeAddress("0x9f8EA09770Dc38Fc61F5a62031b3BE0526d54D92"), "0x9F8Ea09770Dc38fc61f5a62031b3BE0526D54D92");
    // Uppercase and lowercase forms resolve to the same checksummed value.
    assert.equal(
      normalizeAddress("0xC879C018DB60520F4355C26ED1A6D572CDAC1815"),
      normalizeAddress("0xc879c018db60520f4355c26ed1a6d572cdac1815"),
    );
  });

  it("rejects malformed and empty input with a typed error", () => {
    for (const bad of ["", "0x", "not-an-address", "0x1234", "c879c018db60520f4355c26ed1a6d572cdac1815"]) {
      assert.throws(
        () => normalizeAddress(bad),
        (error: unknown) => error instanceof InvalidAddressError && error.code === "INVALID_ADDRESS",
        `expected ${JSON.stringify(bad)} to be rejected`,
      );
    }
  });
});

describe("isEmptyResult / isZeroAddress", () => {
  it("treats 0x and short words as empty", () => {
    assert.equal(isEmptyResult("0x"), true);
    assert.equal(isEmptyResult(""), true);
    assert.equal(isEmptyResult("0x01"), true);
    assert.equal(isEmptyResult(`0x${"0".repeat(64)}`), false);
  });

  it("detects the zero address", () => {
    assert.equal(isZeroAddress(`0x${"0".repeat(40)}`), true);
    assert.equal(isZeroAddress(HOLDER), false);
  });
});
