# Why Arkiv

Criterion: *If you swapped Arkiv for Postgres or any other database, what would your users lose? What did you keep off Arkiv, and why?*

## What users would lose with Postgres

PaisaLink has no other database. Every invoice, payment, merchant profile and note is an Arkiv entity. If you swapped Arkiv for Postgres, these things would change for users:

| What users get today | With Postgres |
|---|---|
| **Anyone can check an invoice without trusting us.** The receipt page `/r/<id>` shows data a judge, a client or an accountant can query themselves. Run `bun run scripts/query.ts` with no API server and no key. | Only our API can answer. Users must trust that we show the real rows. |
| **Each record has a public owner and a public write history on a chain.** Every entity is owned by the writer wallet and every change is a transaction on the Rabdi explorer. | A row can be edited or deleted silently. |
| **Forged records are ignored.** Every read adds `ownedBy(writer)`. Anyone can write an entity tagged `paisalink.invoices`, but ours never show up in the dashboard or on the pay page. | We would build our own auth and audit trail. |
| **Expiry is part of the data.** An unpaid invoice dies 30 days after its due date. A receipt lives for the 90-day refund window. No cleanup job exists in our code. | We would write and run cleanup jobs, and users would have to trust them. |
| **The dashboard can update live from the chain.** `watchEntityEvents` pushes changes. | We would need our own change feed or polling. |
| **Our service can go away and the data stays readable.** The records live on a public network, not on our server. A client can still check their receipt. | If our server dies, so do the records. |
| **One atomic write for "paid".** The payment record and the invoice state change are in one batch. A receipt never exists while its invoice still reads as open. | We would use a database transaction, which only we can see. |

We are also honest about the other side. Postgres is faster and cheaper per write, and has no rate limits. For a product with millions of rows we would think hard. The things above are why a payment record is a good fit for Arkiv anyway: it is small, public-friendly, short-lived, and it benefits from being checkable by other parties.

## What we kept off Arkiv, and why

| Data | Where it lives | Why not on Arkiv |
|---|---|---|
| Private keys, API keys, the Arkiv access key | A secret store and a git-ignored `.env.local` | Entities are public. Secrets must never be on a public chain. |
| World ID nullifiers | `.data/nullifiers.json` on the API server (git-ignored) | A public nullifier would link one human across apps. We store only `verified = 1`. |
| Names, emails, phone numbers, postal addresses | Not collected | Entities are public. PaisaLink needs a wallet and a handle only. The UI tells merchants not to put personal data in the memo. |
| Invoice PDF bytes | Swarm. Only the plain reference is in `swarm_ref`. | An entity holds at most 128 KiB, and a document belongs in content-addressed storage. We never store an encrypted reference, because it contains its key. See [`swarm.md`](swarm.md). |
| Relayer rate-limit counters | API process memory | They change on every request. Writing them to a chain would spend gas on every call. The per-merchant gas total does go to the merchant entity (`gas_used_wei`). |
| Token balances, note ownership, transfer rules | Whitechain contracts | Money and transfer rules must be enforced by the contract. Arkiv holds a searchable mirror, not the truth. |

## Hybrid by design

- **Money and rules:** Whitechain.
- **Searchable records with owners and expiry:** Arkiv.
- **Files:** Swarm.
- **Humans:** World ID.
- **Secrets:** nowhere public.

See [`schema.md`](schema.md) for the entity fields.
