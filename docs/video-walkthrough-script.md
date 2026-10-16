# Video walkthrough script (+50 bonus)

Target length: **3 minutes 30 seconds**. Screen recording with voice-over.
Everything shown is a real run against `https://mcp.pharos.xyz/mcp` — do not cut to slides.

## Before you hit record

```powershell
cd "C:\pharos read contract state"
npm install
npm test          # deterministic, offline
```

Have a second terminal ready with the live command but **do not run it yet**.

Optional: open `https://pharosscan.xyz/address/0xc879c018db60520f4355c26ed1a6d572cdac1815`
in a browser tab to prove the contract is real.

---

## 0:00 – 0:20 · What this is

> "This is the Pharos Agent Arena 'Read Contract State' task. It's a Node and
> TypeScript CLI that reads live state from a deployed Pharos contract through
> Chain MCP, and turns the raw hex into something a non-developer can read."

Show `package.json` and the task name in the title bar.

## 0:20 – 0:50 · The contract and why it is trustworthy

Open `src/pharos.ts`.

> "The chain is Pharos Pacific Mainnet, chain ID 1672. There is no API key and
> no private key anywhere in this project — every call is read-only.
>
> The contract is USDC at `0xC879C018dB60520F4355C26eD1a6D572cdAC1815`. That
> address is not something I made up: it is published in the Pharos Pacific
> Mainnet token registry in the official docs. The same file lists WPROS, LINK
> and WETH, and I verified all four on-chain — bytecode, name, symbol and
> decimals — before committing them."

Scroll the token registry so the addresses are visible.

## 0:50 – 1:35 · The MCP layer

Open `src/mcp/client.ts`.

> "Chain MCP runs over Streamable HTTP. This client is dependency-free: it does
> the real handshake — `initialize`, reads the `mcp-session-id` response header,
> sends `notifications/initialized`, then speaks JSON-RPC 2.0 over
> server-sent events.
>
> It handles the failure modes properly: HTTP 429 is retried while honouring
> `Retry-After`, a non-2xx status becomes a transport error, a timeout becomes a
> transport error, and a JSON-RPC error envelope becomes a protocol error."

Open `src/mcp/chainMcp.ts`.

> "This facade maps the four Chain MCP tools I use — `get_chain_info`,
> `get_code`, `eth_call` and `get_storage_at` — into typed calls."

## 1:35 – 2:20 · Run it live

Switch to the second terminal and run:

```powershell
npm start
```

> "Watch what happens. First it calls `get_chain_info` and confirms we are on
> chain 1672 — if the chain ID did not match, it would abort rather than report
> data from the wrong network."

Point at the "Plain-language summary" block.

> "Here is the human-readable part: the name, the ticker, the decimals, the
> total supply, the balance of a real wallet, and the allowance to a spender.
> Those amounts have decimals applied — six for USDC — so you see
> `525,727.521263` rather than a twenty-digit integer."

Point at the "Values read" table.

> "Every row shows the Solidity signature, which MCP tool produced it, the raw
> hex result, and the decoded value. Nothing here is mocked: this raw hex came
> back from the chain over Chain MCP a second ago."

Point at the block number and hash.

> "Every read is pinned to one block, and that block number and hash are printed,
> so the whole snapshot is consistent and auditable."

## 2:20 – 2:50 · Raw storage and the registry

Point at "Raw storage cross-check".

> "It also calls `eth_getStorageAt`. Storage comes back as an opaque 32-byte
> word, so the code only claims an interpretation when a layout fully validates —
> a WETH9 packed short string, a plain integer, or a candidate address. It never
> guesses a dynamic string out of a single slot.
>
> When a storage word matches the view call — like WPROS slot 0 decoding to
> `Wrapped PROS` — it says so. When it does not match, it says nothing."

Point at the registry table.

> "Finally it sweeps all four tokens from the Pharos registry at that same block
> so the numbers are comparable."

## 2:50 – 3:10 · Error handling

Run:

```powershell
npm start -- --address 0x0000000000000000000000000000000000000001
```

> "A bad address does not produce a stack trace. An address with no contract
> fails with `NOT_A_CONTRACT`. And a malformed address is rejected before any
> network call."

```powershell
npm start -- --address 0xzzz
```

> "That is `INVALID_ADDRESS`, reported with the exact input."

Run `npm test`.

> "The unit tests cover the MCP protocol — the session handshake, SSE parsing,
> 429 retries, timeouts — plus ABI encoding, decimals formatting and storage
> decoding. They run offline against a fake MCP server that speaks the real wire
> protocol. The live check is a separate command so the default test run stays
> deterministic."

## 3:10 – 3:30 · Wrap up

> "So: three or more values read from one contract over Chain MCP, the contract
> address and the block number it was read at, decimals applied and addresses
> labelled, and a README with a verified sample output — that is every
> requirement on the task. Thanks for watching."

---

## Checklist before uploading

- [ ] The live run in the video shows the **real** block number for that moment.
- [ ] `npm test` output is visible and passing.
- [ ] No terminal history leaks a secret (there is no secret in this project).
- [ ] Video is uploaded somewhere publicly viewable and the link is pasted into the submission.
