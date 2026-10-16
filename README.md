# Pharos — Read Contract State (via Chain MCP)

A small, dependency-light TypeScript CLI that reads **live** state from a deployed contract on
**Pharos Pacific Mainnet** through the **Pharos Chain MCP** server, then renders it for a
non-developer: decimals applied, addresses labelled, every raw hex value preserved next to its
decoded and human-readable form.

Built for the Pharos Agent Arena task **"Read Contract State"** (Chain MCP, Easy).

- **Network:** Pharos Pacific Mainnet — chain ID **1672** (`0x688`), native token **PROS**
- **Contract:** USDC — `0xC879C018dB60520F4355C26eD1a6D572cdAC1815`
- **Chain MCP endpoint:** `https://mcp.pharos.xyz/mcp` (hosted, read-only, no API key)
- **Read-only:** the project has no private keys, no mnemonics, and no write path

---

## Requirements from the task, and where they are met

| # | Requirement | Where it is satisfied |
| - | ----------- | --------------------- |
| 01 | Reads **at least 3 different values** from one contract via Chain MCP | 7 values per run: `name`, `symbol`, `decimals`, `totalSupply`, `balanceOf`, `allowance`, `owner` — see [`src/reader.ts`](src/reader.ts) |
| 02 | Shows the **contract address** and the **block number** the data was read at | Report header: address, block number, block hash and block timestamp. Every read is pinned to that one block |
| 03 | Formats raw values for humans — decimals applied, addresses labelled | [`src/chain/erc20.ts`](src/chain/erc20.ts) (`formatTokenAmount`), [`src/pharos.ts`](src/pharos.ts) (`labelAddress`), plus a "Plain-language summary" section |
| 04 | Short README: which contract, how to run, sample output | This file |

Extra: raw `eth_getStorageAt` words are decoded and corroborated against the view calls, and the
whole Pharos token registry is swept at the same block for comparison.

---

## The contract

**USDC on Pharos Pacific Mainnet** — `0xC879C018dB60520F4355C26eD1a6D572cdAC1815`.

The address is **not guessed**. It is published in the Pharos Pacific Mainnet token registry:

- <https://docs.pharos.xyz/getting-started/token-registry.md>

The same registry lists three more tokens, all of which are read by the built-in sweep:

| Symbol | Name            | Address                                      | Decimals |
| ------ | --------------- | -------------------------------------------- | -------- |
| WPROS  | Wrapped PROS    | `0x52C48d4213107b20bC583832b0d951FB9CA8F0B0` | 18       |
| USDC   | USDC            | `0xC879C018dB60520F4355C26eD1a6D572cdAC1815` | 6        |
| LINK   | ChainLink Token | `0x51e2A24742Db77604B881d6781Ee16B5b8fcBE29` | 18       |
| WETH   | Wrapped Ether   | `0x1f4b7011Ee3d53969bb67F59428a9ec0477856E9` | 18       |

Before being committed to [`src/pharos.ts`](src/pharos.ts), every one of those four addresses was
confirmed on-chain through Chain MCP by reading its bytecode (`eth_getCode`) and its `name()`,
`symbol()` and `decimals()`. The network facts (chain ID, RPC URL, MCP endpoint, native symbol)
come from the official MCP repository:

- <https://github.com/PharosNetwork/pharos-mcp>

---

## How it runs

```
  CLI (src/index.ts)
        │  parse args + env
        ▼
  readContractState (src/reader.ts)
        │
        ├─► get_chain_info ─────► verify chain ID 1672, pin the block
        ├─► get_code ───────────► confirm a contract is really deployed there
        ├─► eth_call ───────────► name / symbol / decimals / totalSupply
        │                         balanceOf / allowance / owner
        ├─► get_storage_at ─────► raw storage slots 0,1,2
        ├─► get_block ──────────► block hash + timestamp
        └─► eth_call (registry) ► all four registry tokens at the same block
                │
                ▼
  src/mcp/chainMcp.ts   typed facade over the Chain MCP tools
  src/mcp/client.ts     dependency-free Streamable HTTP + JSON-RPC 2.0 client
                │
                ▼
        https://mcp.pharos.xyz/mcp
```

### Chain MCP tools used

| Tool             | Used for                                                |
| ---------------- | ------------------------------------------------------- |
| `get_chain_info` | chain ID, client version, latest block — and the chain-ID guard |
| `get_code`       | proving the address is a deployed contract (`NOT_A_CONTRACT` otherwise) |
| `eth_call`       | every ERC-20 view call, always pinned to one block      |
| `get_storage_at` | raw storage slots, decoded and corroborated             |
| `get_block`      | block hash and timestamp for the pinned block           |

`src/mcp/client.ts` implements the MCP Streamable HTTP transport directly — `initialize`,
the `mcp-session-id` header, the `notifications/initialized` notification, then JSON-RPC 2.0
over `text/event-stream` — so there is no transport dependency to go stale. It handles
HTTP 429 (retry, honouring `Retry-After`), non-2xx responses, request timeouts, JSON-RPC
error envelopes, and tool-level errors separately.

---

## Setup

Requires **Node.js 20+** (developed and verified on Node 24).

```powershell
git clone <your-repo-url> pharos-read-contract-state
cd "pharos-read-contract-state"
npm install
```

No API key, token, or wallet is required. Optional configuration lives in `.env` — copy
[`.env.example`](.env.example) to `.env` and edit it; every value has a working default.

```powershell
Copy-Item .env.example .env
```

### Run

```powershell
npm start
```

With options:

```powershell
# Inspect a different contract from the registry
npm start -- --address 0x52C48d4213107b20bC583832b0d951FB9CA8F0B0

# Pin reads to a specific block for a reproducible snapshot
npm start -- --block 20360972

# Machine-readable output
npm start -- --json

# Skip the registry sweep
npm start -- --no-registry

# See everything
npm start -- --help
```

Exit codes: `0` success · `1` a read or transport failure · `2` invalid arguments.

| Flag | Env var | Default |
| ---- | ------- | ------- |
| `--address` | `CONTRACT_ADDRESS` | USDC from the registry |
| `--holder` | `HOLDER_ADDRESS` | a wallet that actively transacts on Pharos |
| `--spender` | `SPENDER_ADDRESS` | the Uniswap `SwapRouter` on Pharos |
| `--block` | `BLOCK_NUMBER` | latest block observed at startup |
| `--endpoint` | `PHAROS_MCP_ENDPOINT` | `https://mcp.pharos.xyz/mcp` |
| `--timeout` | `MCP_TIMEOUT_MS` | `20000` |
| `--retries` | `MCP_MAX_RETRIES` | `2` |
| `--registry` / `--no-registry` | `READ_REGISTRY` | on |
| `--json` | — | off |

---

## Verified example output

> A real, unedited run against `https://mcp.pharos.xyz/mcp` on 2026-10-16, exit code `0`.
> Blockchain state is live, so `totalSupply`, balances and the block number will differ
> when you run it — everything else is stable. The full transcript, the automated live
> check's JSON evidence, and the verified failure paths are in
> [`docs/verified-output.md`](docs/verified-output.md).

```text
$ npm start

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

**What this run demonstrates**

- **7 values read from one contract** over Chain MCP (`eth_call`), all `ok` — the task asks for at least 3.
- Every read is **pinned to block 20,362,374**, whose hash and timestamp are printed, so the snapshot is consistent and auditable.
- **Reproducible**: `npm start -- --block 20362374` reproduces that block hash byte-for-byte, so the evidence can be independently checked.
- **Decimals are applied**: raw `24383622998165` base units renders as `24,383,622.998165 USDC`, and the un-scaled integer is kept alongside it.
- **Addresses are labelled** (`USDC (USDC) contract`) or explicitly reported as `unlabelled address` when no published source names them — labels are never invented.
- USDC's slots 0–2 hold 20-byte addresses, not strings. The decoder recognised the layout and presented them as addresses instead of guessing a string.
- `allowance` is exactly `0` and is still reported, not omitted.


---

## Tests, typecheck, lint and build

```powershell
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
npm test            # build + unit tests (offline, deterministic)
npm run test:live   # build + real reads against mcp.pharos.xyz (needs network)
npm run verify      # lint + typecheck + test
```

`npm test` runs against `test/helpers/fakeMcp.ts`, an in-process server that speaks the **real**
Streamable HTTP wire protocol, so the production client is exercised unmodified. A separate
`npm run test:live` performs genuine network reads and asserts the task's guarantees.

Current status: **80 unit tests passing**, lint clean, typecheck clean, build clean
(`npm run verify`).

What the suite covers:

| Area | Tests |
| ---- | ----- |
| MCP handshake | session-ID capture, `notifications/initialized`, header propagation, idempotency |
| SSE parsing | single frame, multiple frames, multi-line data, non-JSON frames |
| MCP failures | HTTP 429 retry, exhausted retries, non-2xx, timeout, unreachable endpoint, malformed/empty responses, JSON-RPC error envelopes |
| ABI layer | canonical selectors, argument encoding, result decoding, `bytes32` name fallback |
| Formatting | 6/18 decimals, thousands grouping, full precision (no rounding), zero |
| Addresses | checksumming, malformed input rejection, bad-checksum re-normalisation, official EIP-55 test vectors |
| Published addresses | every registry/default address round-trips through `getAddress` (a bad checksum cannot ship), uniqueness, on-chain decimals |
| Storage | WETH9 packed short strings, integer slots, all-zero words, dynamic strings, address candidates |
| Reader | ≥3 values, block pinning, chain-ID mismatch, non-contract address, optional-method revert, per-tool failure isolation, registry sweep |
| Config | defaults, flag-over-env precedence, validation, `.env` loading |
| Report | header, tables, arguments, storage, registry, warnings, JSON round-trip |

---

## Error handling

| Situation | Result |
| --------- | ------ |
| Malformed address (`--address 0xzzz`) | `INVALID_ADDRESS`, exit `2` — no network call is made |
| Address with no contract | `NOT_A_CONTRACT`, exit `1`, before any state is reported |
| Wrong chain | `CHAIN_MISMATCH`, exit `1`, so foreign data is never presented as Pharos data |
| Method not implemented (e.g. `owner()` on WETH-style tokens) | reported as `not implemented` with the revert reason — **not** as a zero, and it does not fail the run |
| MCP rate limit (HTTP 429) | retried with `Retry-After`; then `MCP_RATE_LIMIT`, exit `1` |
| MCP unreachable / timeout | `MCP_TRANSPORT`, exit `1`, with a hint about the endpoint |
| One value fails mid-run | that row is marked `ERROR` with the reason; the other values are still reported; exit `1` |
| `decimals()` cannot be read | base-unit amounts are shown explicitly un-scaled, plus a warning — never a silently wrong number |

Every path above was exercised against the live endpoint; the exact messages and exit
codes are recorded in [`docs/verified-output.md`](docs/verified-output.md).

---

## Layout

```
.
├── src/
│   ├── index.ts              CLI entry point and exit codes
│   ├── config.ts             argv + env + .env parsing and validation
│   ├── reader.ts             orchestrates the read; builds the report
│   ├── report.ts             human-readable and JSON rendering
│   ├── pharos.ts             verified network facts + token registry
│   ├── errors.ts             typed errors and stable error codes
│   ├── chain/
│   │   ├── erc20.ts          ERC-20 ABI, encoding/decoding, decimals formatting
│   │   └── storage.ts        raw storage-word interpretation
│   └── mcp/
│       ├── client.ts         Streamable HTTP + JSON-RPC 2.0 MCP client
│       └── chainMcp.ts       typed facade over the Chain MCP tools
├── test/
│   ├── helpers/fakeMcp.ts    in-process server speaking the real MCP protocol
│   ├── erc20.test.ts  storage.test.ts  mcpClient.test.ts
│   ├── reader.test.ts  config.test.ts  report.test.ts
│   └── live-check.ts         real network verification (npm run test:live)
├── docs/
│   ├── verified-output.md       real transcripts, live evidence, failure paths
│   └── video-walkthrough-script.md
├── .env.example   .gitignore   eslint.config.mjs
├── package.json   tsconfig.json
└── README.md
```

## Security

This project only reads. It sends no transactions, needs no private key, and stores no secrets.
`eth_call` is a read-only RPC method; the hosted Chain MCP endpoint disables
`send_raw_transaction`. `.env` is git-ignored and `.env.example` contains placeholders only.

## License

MIT
