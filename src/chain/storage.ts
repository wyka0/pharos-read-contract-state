/**
 * Interpretation of raw 32-byte storage words.
 *
 * The task asks for "raw storage and view calls" to be turned into something a
 * non-developer can read. `eth_getStorageAt` returns an opaque 32-byte word, so
 * this module applies the well-known layouts Solidity emits and only claims an
 * interpretation that fully validates:
 *
 *   - `short-string`  Solidity packs strings shorter than 32 bytes left-aligned
 *                     and stores `length * 2` in the final byte (the WETH9
 *                     layout). Accepted only when the trailing byte is even and
 *                     in range, the padding after the content is zero, and every
 *                     content byte is printable ASCII.
 *   - `uint256`       the big-endian integer value, always reported.
 *   - `address`       offered only as a *candidate* when the leading 12 bytes are
 *                     zero and the remaining 20 bytes are non-zero.
 *
 * A dynamic (>= 32 byte) string is deliberately NOT claimed from a single slot:
 * its length and data live in separate slots, so guessing would be fabrication.
 */

import { getAddress } from "viem";

export type StorageWordKind = "short-string" | "uint256" | "empty";

export interface DecodedStorageWord {
  /** The raw 0x-prefixed 32-byte word exactly as returned by `eth_getStorageAt`. */
  raw: string;
  /** The interpretation that fully validated. */
  kind: StorageWordKind;
  /** String content, for `short-string`. */
  text?: string;
  /** Decimal value, for `uint256`. */
  value?: string;
  /** Checksummed address offered only when the layout is consistent. */
  addressCandidate?: string;
  /** Human-readable rendering of the chosen interpretation. */
  display: string;
}

function hexToBigInt(value: string): bigint {
  const body = value.replace(/^0x/, "");
  return body ? BigInt("0x" + body) : 0n;
}

function isPrintableAscii(bytes: readonly number[]): boolean {
  return bytes.every((byte) => byte >= 0x20 && byte <= 0x7e);
}

/**
 * Decode a single storage word.
 *
 * @param raw  0x-prefixed 32-byte word from `eth_getStorageAt`.
 */
export function decodeStorageWord(raw: string): DecodedStorageWord {
  const body = raw.replace(/^0x/, "").toLowerCase();
  if (body.length !== 64) {
    return { raw, kind: "empty", display: "not a 32-byte word" };
  }

  const bytes: number[] = [];
  for (let i = 0; i < 64; i += 2) bytes.push(Number.parseInt(body.slice(i, i + 2), 16));

  const bigintValue = hexToBigInt(body);
  if (bigintValue === 0n) {
    return { raw, kind: "empty", value: "0", display: "0 (all 32 bytes zero)" };
  }

  // Solidity short-string layout: length*2 in the final byte, content left-aligned.
  const lengthByte = bytes[31] ?? 0;
  if (lengthByte > 0 && lengthByte <= 62 && lengthByte % 2 === 0) {
    const contentLength = lengthByte / 2;
    const content = bytes.slice(0, contentLength);
    const padding = bytes.slice(contentLength, 31);
    if (isPrintableAscii(content) && padding.every((byte) => byte === 0)) {
      const text = content.map((byte) => String.fromCharCode(byte)).join("");
      return { raw, kind: "short-string", text, display: `"${text}" (Solidity short-string)` };
    }
  }

  // Address candidate: leading 12 bytes zero, remaining 20 bytes non-zero.
  const leading = bytes.slice(0, 12);
  const trailing = bytes.slice(12);
  let addressCandidate: string | undefined;
  if (leading.every((byte) => byte === 0) && trailing.some((byte) => byte !== 0)) {
    try {
      addressCandidate = getAddress("0x" + body.slice(24));
    } catch {
      addressCandidate = undefined;
    }
  }

  // When the word looks like a 20-byte address, lead with the address: it is
  // what a reader can actually act on. The raw integer stays available on
  // `value` and in the JSON report.
  return {
    raw,
    kind: "uint256",
    value: bigintValue.toString(),
    ...(addressCandidate ? { addressCandidate } : {}),
    display: addressCandidate
      ? `${addressCandidate} (20-byte address in a 32-byte word)`
      : bigintValue.toString(),
  };
}

/** True when a decoded storage word corroborates a view-call result. */
export function matchesViewValue(decoded: DecodedStorageWord, viewValue: string | number | bigint | null): boolean {
  if (viewValue === null || viewValue === undefined) return false;
  if (decoded.kind === "short-string") return decoded.text === String(viewValue);
  if (decoded.kind === "uint256") return decoded.value === String(viewValue);
  return false;
}
