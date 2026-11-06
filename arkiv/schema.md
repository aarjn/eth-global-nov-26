# PaisaLink on Arkiv: schema

Arkiv is PaisaLink's only database. Every merchant profile, invoice, payment receipt and invoice-note record is an Arkiv entity on the **Rabdi** testnet (chain id 7794095). There is no Postgres, no SQLite and no in-memory store in the running app.

- SDK: `@arkiv-network/sdk` 1.0.1 (typed schemas). Code: `packages/arkiv/src/schemas.ts` (schemas), `mapping.ts` (domain to attributes, expiry policy), `store.ts` (reads and writes).
- Writer wallet: `0xf4a0841215766eAD8239d223E4E8caB91ff1fDeb` ([explorer](https://rabdi.explorer.arkiv.network/address/0xf4a0841215766eAD8239d223E4E8caB91ff1fDeb)). Only the API server signs with it.
- Trust: anyone can write an entity tagged `paisalink.invoices`, so **every read adds `ownedBy(writer)`**. A forged invoice from another wallet never reaches the checkout page or the dashboard.
- Run the query yourself: `bun install && bun run scripts/query.ts [merchantAddress]`. It prints the exact query string it sends.

## Entities

Each schema is a named `defineSchema(...)`. The SDK adds the indexed tag attribute `arkiv.schema = str('<name>')` to every create, and `.from(schema)` filters on it. All attribute names are lowercase snake_case.

### `paisalink.merchants`: one per merchant wallet

| Attribute | Type | Indexed | Why |
|---|---|---|---|
| `wallet` | addr | yes | `GET /merchants/:wallet`, the relayer's merchant lookup |
| `handle` | str | yes | public handle shown on the pay page; checks that a handle is unique |
| `verified` | u64 (0/1) | yes | set to 1 only after the server verifies a World ID Proof of Human. The relayer pays gas only for verified merchants, and `eq("verified", 1)` lists them |
| `gas_used_wei` | u256 | no | sponsored gas spent for this merchant (drain protection). Stored, never filtered |
| `created_at` | u64 | no | unix seconds. Set on the first write and never changed |

Expiry: **180 days**, renewed by activity. Every merchant write that would add at least a day of life also extends the entity in the **same transaction** (`executeBatch` with a patch and an extension). An inactive merchant expires by itself, and its sponsored-gas eligibility goes with it.

### `paisalink.invoices`: one per invoice; the payment link `/pay/<invoice_id>` reads it

| Attribute | Type | Indexed | Why |
|---|---|---|---|
| `merchant` | addr | yes | the dashboard list: `merchant = addr(..) AND $owner = addr(writer)` |
| `invoice_id` | str | yes | bytes32 hex, lowercase, the same id as the onchain `PaymentRouter` invoice. Used by checkout and receipt lookups |
| `state` | str | yes | `open`, `paid`, `refunded`, `financed` or `settled`. Allows "open invoices" filters |
| `amount_usdt` | dec | no | the amount in USDT, exact decimal (canonical form: `"49.50"` is stored and read as `"49.5"`) |
| `due_at` | u64 | yes | unix seconds. Allows range queries such as "overdue" (`due_at < now AND state = open`) |
| `memo` | str | no | at most 128 bytes, the merchant's own text. The UI tells merchants not to put personal data here |
| `swarm_ref` | str, optional | no | plain Swarm reference of the invoice PDF (see `swarm.md`). Never an encrypted reference |
| `pay_tx` | str, optional | no | Whitechain tx hash of the USDT payment |

Expiry: **due date + 30 days** (at least 7 days for an invoice created already overdue; capped at the protocol maximum of 7,884,000 blocks, about 182.5 days). When an invoice leaves `open` (paid, refunded, financed), its lifetime is extended to **at least 90 days from then**, to cover the refund window and the accountant export. An unpaid invoice dies a month after it is due with no cleanup job.

### `paisalink.payments`: one per paid invoice; the receipt page `/r/<invoice_id>` reads it

| Attribute | Type | Indexed | Why |
|---|---|---|---|
| `invoice_id` | str | yes | receipt lookup |
| `merchant` | addr | yes | the merchant's payments list and the CSV export |
| `payer` | addr | no | payer wallet (a pseudonymous address, already public onchain) |
| `amount_usdt` | dec | no | |
| `tx_hash` | str | no | Whitechain tx hash; the receipt links to the explorer |
| `gasless` | u64 (0/1) | no | 1 if our relayer paid the gas (EIP-3009) |
| `paid_at` | u64 | yes | unix seconds. Range queries by accounting period |
| `refund_tx` | str, optional | no | Whitechain tx hash of the refund |

Expiry: **90 days**, the refund and dispute window. Creating a payment and marking its invoice `paid` (with `pay_tx`) happen in **one atomic batch**, so a receipt never exists while its invoice still reads as open.

### `paisalink.notes`: mirror of `InvoiceNote` (invoice financing); the investor page reads it

| Attribute | Type | Indexed | Why |
|---|---|---|---|
| `invoice_id` | str | yes | the note for an invoice |
| `note_id` | u64 | yes | the onchain note id; the upsert lookup key |
| `issuer` | addr | yes | the merchant's financed invoices |
| `investor` | addr, optional | no | set once funded |
| `face_usdt` | dec | no | paid to the holder at maturity |
| `price_usdt` | dec | no | what the investor paid |
| `maturity` | u64 | yes | unix seconds. Allows "maturing soon" range queries |
| `state` | str | yes | `issued`, `funded` or `settled` |

Expiry: **maturity + 30 days**. The contract stays the source of truth for balances and transfer rules; the entity is the searchable mirror.

## Writes and reads

- **Upserts, not appends.** `upsertX` looks the entity up by its natural id (`invoice_id`, `wallet`, `note_id`) with `ownedBy(writer)`. If it exists, the store patches only the changed attributes; if nothing changed, it sends no transaction. If it does not exist, the store creates it. Re-running a script or retrying a request does not duplicate entities. (`predictEntityKey` cannot give idempotency: the key is derived from the owner's entity nonce and a salt, not from content. See `friction.md`.)
- **One writer, serialized.** All writes from the API go through one queue, so the wallet's nonce sequence never races and a check-then-create cannot run twice at once.
- **Read-after-write.** After every write the store records the receipt's block, and later queries are retried until the node answers from a later block (node issue #241: a read right after a receipt can return the previous state).
- **Paging** by `$key` (`orderBy(asc("$key"))` plus `gt("$key", key(last))`) at 100 rows per page, as the SDK docs advise for stable pages.
- **Live dashboard** with `watchEntityEvents` over a WebSocket transport. Events carry only the entity key and owner, so the store fetches each new key once to classify it (schema tag plus merchant) and remembers it.
- **Rate-limit guard.** On an HTTP 429 from the Arkiv RPC, a process-wide breaker stops all Arkiv HTTP calls until `Retry-After` (default 30 min), instead of extending the lockout. The API then returns `{code: "ARKIV_RATE_LIMITED"}`. Writes are refused without an access key unless `ARKIV_ALLOW_ANON_WRITES=1` is set.

## Kept off Arkiv, and why

| Data | Where | Why |
|---|---|---|
| Private keys, API keys, the Arkiv access key | `lechu-secret` and the git-ignored `.env.local` | secrets never go on a public chain |
| World ID nullifiers | `.data/nullifiers.json` on the API server (git-ignored; owned by the World ID workstream) | a public nullifier links one human across apps; we store only `verified = 1` |
| Names, emails, phone numbers, addresses of people | not collected | Arkiv entities are public; PaisaLink needs a wallet and a handle only |
| Invoice PDF bytes | Swarm; only the reference is in `swarm_ref` | an entity holds at most 128 KiB of bytes, and a document belongs in content-addressed storage |
| Relayer rate-limit counters | API process memory | high-churn per-request counters; persisting them would spend gas on every request. The per-merchant gas total does go to the merchant entity (`gas_used_wei`) |
| Token balances, note ownership, transfer rules | Whitechain contracts | money and transfer rules are enforced onchain; Arkiv mirrors them for search |
