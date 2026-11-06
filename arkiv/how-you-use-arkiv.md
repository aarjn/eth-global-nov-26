# How PaisaLink uses Arkiv

Criterion: *Do the things you filter on, who can edit each entity, and when it expires fit what your app does? Does each Arkiv feature you use change something your users see?*

Full field list: [`schema.md`](schema.md). Code: `packages/arkiv/src/` (`schemas.ts`, `mapping.ts`, `store.ts`).

## Filters: what we query on and why

| Query | Filter | What the user sees |
|---|---|---|
| Merchant dashboard list | `arkiv.schema = invoices AND merchant = <wallet> AND $owner = <writer>` | The invoice list on `/merchant` |
| Pay page and receipt page | `invoice_id = <id>` (indexed) | `/pay/<id>` and `/r/<id>` |
| Open invoices | `state = "open"` (indexed), via `GET /merchants/:wallet/invoices?state=open` | Only open invoices, for clients of the API |
| Overdue invoices | `due_at` is indexed, so `due_at < now AND state = open` works as a range query. The dashboard currently computes the "Overdue" badge in the browser from `due_at`. | "Overdue" label in the invoice list |
| Payments for a merchant | `merchant` (indexed), newest first by `paid_at` (indexed, so period range queries are possible; the CSV export currently covers all payments) | CSV export and payments list |
| Handle lookup | `handle = <text>` (indexed) | "Handle already taken" on sign-up |
| Verified merchants | `verified = 1` (indexed) | The verified badge and the gasless path |
| Notes by issuer or invoice | `issuer`, `invoice_id`, `maturity`, `state` (indexed) | The `/invest` list |

Only fields we actually filter on are indexed (`amount_usdt`, `memo`, `pay_tx`, `tx_hash` and similar are not). Run the main query yourself with `bun run scripts/query.ts`; it prints the exact query string.

## Ownership: who can edit each entity

- **One writer wallet** (`0xf4a0841215766eAD8239d223E4E8caB91ff1fDeb`) creates and edits every entity. Only the API server holds its key.
- **Every read uses `ownedBy(writer)`.** Arkiv is open: anyone can write an entity with our schema tag. The owner filter means forged invoices never reach a page.
- **Why one writer:** it keeps nonces ordered (one write queue), lets the server enforce who may change what (for example, only the relayer path marks an invoice `paid`), and keeps the demo simple.
- **Honest trade-off:** this makes PaisaLink a trusted operator of the data. It is not merchant-owned data yet. Moving to merchant-owned entities is on the roadmap ([`reach.md`](reach.md)).
- Personal data is never written (see [`why-arkiv.md`](why-arkiv.md)).

## Expiry: when each entity dies, and why

| Entity | Lifetime | Product reason |
|---|---|---|
| `paisalink.merchants` | 180 days, renewed by activity | A lease. An inactive merchant expires by itself, and its sponsored-gas eligibility goes with it. Renewal is batched with the write in one transaction. |
| `paisalink.invoices` (open) | due date + 30 days (at least 7 days) | An unpaid invoice stops being relevant a month after it is due. No cleanup job. |
| `paisalink.invoices` (paid, refunded, financed, settled) | extended to at least 90 days from the change | Covers the refund window and the accountant export. |
| `paisalink.payments` | 90 days | The refund and dispute window. |
| `paisalink.notes` | maturity + 30 days | The note stays visible for a while after settlement, then goes. |

The code is `invoiceLifetime`, `paymentLifetime`, `noteLifetime` and `merchantLifetime` in `packages/arkiv/src/mapping.ts`, and `extendEntity` calls in `store.ts`. For the demo we make sure demo entities live at least 7 days, so judges can still see them.

## Each Arkiv feature and what the user sees

| Arkiv feature | Where | What changes for the user |
|---|---|---|
| Typed schemas and indexed attributes | `schemas.ts` | Fast, exact lookups for the pay page, dashboard and receipt. |
| `ownedBy(writer)` | every read in `store.ts` | A forged invoice never shows up. |
| Expiry per entity type | `mapping.ts` | Old unpaid invoices disappear on their own. Receipts stay for the refund window. |
| `extendEntity` as a lease | `store.ts` | A merchant that keeps working keeps their profile. An invoice stays visible for 90 days after it is paid. |
| `executeBatch` (atomic) | `store.ts` | The receipt and the "paid" state appear together. The dashboard never shows a payment on an open invoice. |
| `watchEntityEvents` over WebSocket | `store.ts` | The dashboard updates live when a client pays. |
| Indexed `due_at`, `paid_at`, `maturity` (ready for range queries) | `schemas.ts` | Today: newest-first payment lists and the overdue label. Next: accounting periods and "maturing soon". |
| `swarm_ref` attribute | `schemas.ts` | "Open PDF on Swarm" on the receipt. |
| Entity links on the Rabdi explorer (`arkivUrl`) | API responses, dashboard | An "Arkiv record" link per invoice, so a user can see the entity itself. |

## Features we did not use, on purpose

- `changeOwnership`: not needed with a single writer. Merchant-owned entities would use it.
- `$creator` in the UI: not shown yet. A good next step for trust.
