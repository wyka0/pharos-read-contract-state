# Verified live output

Captured from a real run against the hosted Pharos Chain MCP endpoint
(`https://mcp.pharos.xyz/mcp`) on **2026-10-16**. Nothing on this page is mocked,
replayed, or hand-written: it is the verbatim stdout of the commands shown.

Blockchain state moves, so `totalSupply`, balances and the block number will differ
on a later run. The contract address, chain ID, decimals and the shape of the output
are stable.

---

## 1. `node dist/src/index.js` — exit code 0

```text
Pharos — Read Contract State (via Chain MCP)
============================================

Network        Pharos Pacific Mainnet (chain ID 1672 / 0x688)
Native token   PROS
Node client    portal/1.0.0
JSON-RPC       https://rpc.pharos.xyz
Chain MCP      https://mcp.pharos.xyz/mcp
Read at block  20,362,374  (0x136b486)
Block hash     0x0419460260a4b2cdb57b62ab4dfafdc650418245762b23fe60715a2256f166ee
Block time     2026-10-16T04:22:47.000Z
Block source   latest block observed at startup
Generated      2026-10-16T04:22:58.358Z

Contract       0xC879C018dB60520F4355C26eD1a6D572cdAC1815
Contract label USDC (USDC) contract
Bytecode       1,798 bytes (eth_getCode confirms a deployed contract)

Plain-language summary
----------------------
• This contract is an ERC-20 token called "USDC" with the ticker USDC, deployed at 0xC879C018dB60520F4355C26eD1a6D572cdAC1815.
• Amounts are stored as whole numbers with 6 decimal places, so 1 USDC is represented on-chain as 10^6 base units.
• The total supply is 24,383,622.998165 (24,383,622,998,165 base units) USDC.
• The wallet 0x912c9aDe24D44d8922f0866D8Dcb079f1363f647 currently holds 526,636.522995 (526,636,522,995 base units) USDC.
• That wallet has authorised the spender 0xf38d34c8382b9079b0f85309578b43b8479Cd875 to transfer up to 0 (0 base units) USDC on its behalf.
• The contract's owner is 0x9F8Ea09770Dc38fc61f5a62031b3BE0526D54D92 — unlabelled address.
• Every value above was read at block 20,362,374 (0x136b486), so the whole snapshot is consistent.

Values read from this contract via Chain MCP
-------------------------------------------
FIELD        SOLIDITY                    MCP TOOL  STATUS  RAW RESULT                HUMAN-READABLE
-----------  --------------------------  --------  ------  ------------------------  ---------------------------------------------------------------
name         name()                      eth_call  ok      0x0000000000000000000...  USDC
symbol       symbol()                    eth_call  ok      0x0000000000000000000...  USDC
decimals     decimals()                  eth_call  ok      0x0000000000000000000...  6 decimals
totalSupply  totalSupply()               eth_call  ok      0x0000000000000000000...  24,383,622.998165 (24,383,622,998,165 base units) USDC
balanceOf    balanceOf(address)          eth_call  ok      0x0000000000000000000...  526,636.522995 (526,636,522,995 base units) USDC
allowance    allowance(address,address)  eth_call  ok      0x0000000000000000000...  0 (0 base units) USDC
owner        owner()                     eth_call  ok      0x0000000000000000000...  0x9F8Ea09770Dc38fc61f5a62031b3BE0526D54D92 — unlabelled address

Arguments used
--------------
balanceOf: 0x912c9aDe24D44d8922f0866D8Dcb079f1363f647
allowance: 0x912c9aDe24D44d8922f0866D8Dcb079f1363f647 -> 0xf38d34c8382b9079b0f85309578b43b8479Cd875

Raw storage cross-check (eth_getStorageAt, same block)
-----------------------------------------------------
SLOT  RAW WORD                    INTERPRETATION                                                                  CORROBORATES
----  --------------------------  ------------------------------------------------------------------------------  ------------
0x0   0x000000000000000000000...  0x9F8Ea09770Dc38fc61f5a62031b3BE0526D54D92 (20-byte address in a 32-byte word)  —
0x1   0x000000000000000000000...  0x828409Db274caD94AC10db6D54aeCa1Dbe00e237 (20-byte address in a 32-byte word)  —
0x2   0x000000000000000000000...  0xbA8Cd4958d4105Aaa23b00c645573F53fCd59486 (20-byte address in a 32-byte word)  —

Storage words are interpreted only when a layout fully validates; a dynamic
string is never claimed from a single slot.

Pharos Pacific Mainnet token registry, read at the same block
------------------------------------------------------------
SYMBOL  NAME (on-chain)  ADDRESS                                     DECIMALS  TOTAL SUPPLY                         STATUS
------  ---------------  ------------------------------------------  --------  -----------------------------------  ------
WPROS   Wrapped PROS     0x52C48d4213107b20bC583832b0d951FB9CA8F0B0  18        23,285,109.172108762262544861 WPROS  ok
USDC    USDC             0xC879C018dB60520F4355C26eD1a6D572cdAC1815  6         24,383,622.998165 USDC               ok
LINK    ChainLink Token  0x51e2A24742Db77604B881d6781Ee16B5b8fcBE29  18        2.972781885597664963 LINK            ok
WETH    Wrapped Ether    0x1f4b7011Ee3d53969bb67F59428a9ec0477856E9  18        0.014182963869551469 WETH            ok

Chain MCP tools used in this run
-------------------------------
eth_call, get_block, get_chain_info, get_code, get_storage_at
```

### Notes on this run

- **7 distinct values** were read from the single USDC contract, all `ok` — the task
  requires at least 3.
- All 7 reads are pinned to **block 20,362,374** and that block's hash and timestamp
  are printed, so the snapshot is internally consistent and auditable.
- The USDC contract on Pharos **does** implement `owner()`, and it resolved to
  `0x9F8Ea09770Dc38fc61f5a62031b3BE0526D54D92`. It is reported as "unlabelled
  address" because there is no published source naming that address — the tool does
  not guess labels.
- USDC storage slots 0, 1 and 2 hold 20-byte addresses, not strings. The decoder
  recognised the layout and presented them as addresses. It correctly did **not**
  claim `name`/`symbol` from those slots.
- `allowance` is exactly `0`, shown as `0 (0 base units) USDC` rather than being
  omitted.

---

## 2. `npm run test:live` — exit code 0

The automated live check re-runs the reads and asserts the task's guarantees
(chain ID is 1672, the address is a contract, ≥ 3 values, no failed reads, a numeric
block and hash are reported, raw storage succeeds, every registry token reads
cleanly). It ends with:

```text
Live check passed: 7 values read at block 20362388.
```

Its JSON evidence block (abridged to the value rows):

```json
{
  "network": "Pharos Pacific Mainnet",
  "chainId": 1672,
  "contract": "0xC879C018dB60520F4355C26eD1a6D572cdAC1815",
  "contractLabel": "USDC (USDC) contract",
  "block": "20362388",
  "blockHash": "0x…",
  "mcpToolsUsed": ["eth_call", "get_block", "get_chain_info", "get_code", "get_storage_at"],
  "values": [
    { "key": "name",        "status": "ok", "decoded": "USDC",                 "formatted": "USDC" },
    { "key": "symbol",      "status": "ok", "decoded": "USDC",                 "formatted": "USDC" },
    { "key": "decimals",    "status": "ok", "decoded": "6",                    "formatted": "6 decimals" },
    { "key": "totalSupply", "status": "ok", "decoded": "24383622998165",       "formatted": "24,383,622.998165 (24,383,622,998,165 base units) USDC" },
    { "key": "balanceOf",   "status": "ok", "decoded": "526636522995",         "formatted": "526,636.522995 (526,636,522,995 base units) USDC" },
    { "key": "allowance",   "status": "ok", "decoded": "0",                    "formatted": "0 (0 base units) USDC" },
    { "key": "owner",       "status": "ok", "decoded": "0x9F8Ea09770Dc38fc61f5a62031b3BE0526D54D92", "formatted": "0x9F8Ea09770Dc38fc61f5a62031b3BE0526D54D92 — unlabelled address" }
  ]
}
```

---

## 3. Failure paths (all exercised against the live endpoint)

| Command | stderr | Exit code |
| ------- | ------ | --------- |
| `node dist/src/index.js --address 0xzzz` | `[INVALID_ADDRESS] Invalid EVM contract address: "0xzzz". Expected a 0x-prefixed 20-byte hex address.` | `2` |
| `node dist/src/index.js --bogus` | `Argument error: Unknown argument: --bogus. Run with --help for usage.` | `2` |
| `node dist/src/index.js --address 0x0000000000000000000000000000000000000001` | `[NOT_A_CONTRACT] No contract is deployed at 0x0000…0001 on Pharos Pacific Mainnet. It may be an externally-owned account or an address from another network.` | `1` |
| `node dist/src/index.js --block 99999999999999 --no-registry` | `[MCP_TOOL] MCP tool "get_code" failed: block is not available` | `1` |
| `node dist/src/index.js --endpoint https://127.0.0.1:9/mcp` | `[MCP_TRANSPORT] Could not reach the Chain MCP endpoint …` | `1` |
| `node dist/src/index.js --help` | usage text on stdout | `0` |

A malformed address is rejected **before any network call is made**.
