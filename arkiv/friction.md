# Arkiv friction log

What got in our way while building PaisaLink on Arkiv, in bug-tracker form. Everything here was hit for real while building `packages/arkiv`. Raw notes: [`docs/feedback/arkiv-sdk-notes.md`](../docs/feedback/arkiv-sdk-notes.md).

- **SDK:** `@arkiv-network/sdk` 1.0.1 (viem 2.57.16, bun 1.4.3)
- **Network:** Rabdi testnet, chain id 7794095
- **Date:** 6 Nov 2026 (one day of building)
- **Praise first, so you know we used it well:** typed schemas (`defineSchema`) caught several mistakes at compile time. `executeBatch` made the payment-plus-invoice write atomic. `watchEntityEvents` gave us a live dashboard with little code. The query builder is pleasant to read.

## Summary: what to fix first

| # | Priority | One line |
|---|---|---|
| 1 | High | The hub (faucet and access keys) can't be used without an email, a captcha and a browser session. No script path. |
| 2 | High | A 429 is not a typed error, and viem's default retry makes the lockout longer. |
| 3 | Medium | `predictEntityKey` can't make writes idempotent. |
| 4 | Medium | Entity events carry only key and owner. |
| 5 | Medium | Write shape and read shape of attributes differ. |
| 6 | Low | `dec` drops trailing zeros. |
| 7 | Low | The typed `where()` breaks inside generic helpers. |
| 8 | Medium | `extendEntity` needs the current expiry, and the semantics are easy to get wrong. |
| 9 | Medium | Read right after a receipt can return older state (node issue #241). |
| 10 | Low | Old tutorials target SDK 0.8 / 0.9. |

## Issues

### 1. The hub has no programmatic path (High)

- **Version:** hub.arkiv.network on 6 Nov 2026; SDK 1.0.1.
- **What we expected:** a way to get tGLM and an access key from a script, using the wallet signature we already use for SIWE sign-in.
- **What happened:** sign-in works with SIWE, but registration asks for an email. The faucet claim (`POST /api/faucet`) and key creation send a Cap proof-of-work captcha token from a browser widget. `GET /api/faucet` returns 401 even with a valid wallet signature.
- **How to reproduce:** try to claim tGLM or create an access key with `curl` and a signed SIWE message. The captcha token is required.
- **Impact:** an agent or CI job can't set up a writer wallet. We had to stop the build and hand the step to the human. The first write waited until the human finished it.
- **Suggestion:** an API-key-by-signature path for testnet, or a documented CLI. At least, say on the faucet page that a captcha is needed so people can plan.

### 2. A 429 is untyped, and the default retry extends the lockout (High)

- **Version:** SDK 1.0.1 (related to arkiv-sdk-js #126).
- **Expected:** a typed error such as `RateLimitedError` with `retryAfter`, and no automatic retry on a lockout.
- **Actual:** anonymous writes hit `429 ANON_COST_LIMITED`, which lasts about 27 minutes. The SDK surfaces it as a plain error. viem's default transport retries a 429 three times, which can extend the lockout.
- **Reproduce:** write without an access key repeatedly until the limit appears, then keep calling.
- **Our workaround:** `packages/arkiv/src/client.ts` wraps `fetch`. On a 429 it sets a process-wide breaker until `Retry-After` (default 30 minutes), uses `retryCount: 0` for writes and `1` for reads, and throws our own `ArkivRateLimitedError`. The API turns it into `{code: "ARKIV_RATE_LIMITED"}`. Writes without an access key are refused unless `ARKIV_ALLOW_ANON_WRITES=1`.
- **Suggestion:** a typed error, `Retry-After` honoured by default, and a clear docs warning that anonymous writes can lock you out.

### 3. `predictEntityKey` can't give idempotent re-runs (Medium)

- **Version:** SDK 1.0.1.
- **Expected:** a key derived from content, so that running the same import twice finds the same entity.
- **Actual:** the key is derived from the owner's entity nonce plus a salt. It doesn't depend on content.
- **Reproduce:** call `predictEntityKey` with the same salt after writing a new entity. The key changes.
- **Workaround:** every entity has our own id attribute (`invoice_id`, `wallet`, `note_id`). Writes are upserts: query by that attribute with `ownedBy(writer)`, then patch or create. See [`schema.md`](schema.md).
- **Suggestion:** an optional "key from content" mode, or a `createOrUpdate` by a unique attribute.

### 4. Entity events carry only the key and owner (Medium)

- **Version:** SDK 1.0.1, `watchEntityEvents`.
- **Expected:** the event includes the schema tag, or at least the changed attributes.
- **Actual:** only the entity key and owner. To tell an invoice from a payment, we fetch each new key once.
- **Workaround:** `store.ts` classifies a new key by fetching it, then caches the answer.
- **Suggestion:** include the indexed attributes, or at least `arkiv.schema`, in the event.

### 5. Write shape and read shape don't match (Medium)

- **Version:** SDK 1.0.1.
- **Expected:** what you write is what you read back.
- **Actual:** you can write bare values, but reads return `{type, value}` objects. Round-tripping needs a mapper.
- **Workaround:** `packages/arkiv/src/mapping.ts` has `xToValues` and `xFromRow` pairs, each tested.
- **Suggestion:** a `.value` helper on the row type, or a flat read mode.

### 6. `dec` drops trailing zeros (Low)

- **Version:** SDK 1.0.1.
- **Expected:** `"49.50"` reads back as `"49.50"`.
- **Actual:** it reads back as `"49.5"`.
- **Impact:** a money amount changes its text form. Our UI formats amounts at display time. An exact string match against the original input fails.
- **Suggestion:** document the canonical form, or keep the scale.

### 7. The typed `where()` breaks inside generic helpers (Low)

- **Version:** SDK 1.0.1, TypeScript 7.0.2.
- **Expected:** a generic `findBy<S extends Schema>(schema, attr, value)` helper type-checks.
- **Actual:** the attribute-name types don't flow through a generic. We used casts in a few places.
- **Suggestion:** a documented pattern for generic helpers, or a looser `where` overload.

### 8. `extendEntity` needs the current expiry (Medium)

- **Version:** SDK 1.0.1.
- **Expected:** "add N days" or "keep until at least T".
- **Actual:** the call takes a new expiry, and the node rejects any extension that would move the expiry earlier. You must read the entity's current expiry block first. Older posts say `ExpirationTime.fromDays(n)` means "n days from now", not "n days added" (arkiv-sdk-js #122). Behaviour in 1.0.1 isn't clear from the docs.
- **Workaround:** `store.ts` reads the current expiry, computes the target, and only extends when it adds at least a day. A merchant write batches the patch and the extension in one transaction (`executeBatch`).
- **Suggestion:** an `extendBy` / `ensureExpiresAfter` helper, and a docs line stating the exact semantics.

### 9. Read-after-write can return the previous state (Medium)

- **Version:** Arkiv node, issue #241 (open).
- **Expected:** a query after a receipt sees the write.
- **Actual:** it can return the previous block's state.
- **Workaround:** the store records the block of each write receipt and retries a read until the node answers from a later block (`store.ts`, "Re-runs a query until the node answers from a block after our last write").
- **Suggestion:** an `atBlock` / `minBlock` read option, or fix the lag.

### 10. Old tutorials target the wrong SDK (Low)

- **Version:** blog posts and tutorials for SDK 0.8 / 0.9 on the old testnet.
- **Expected:** examples match the current SDK.
- **Actual:** the annotation / payload API and day-based expiry in old posts don't exist in 1.0.1. An LLM will write the old API from memory.
- **Workaround:** pin 1.0.1 and read `node_modules/@arkiv-network/sdk/**/*.d.ts` before writing code. We put that in every agent brief.
- **Suggestion:** a version banner on old posts and a "1.0 migration" page.

## Smaller things

- Attribute names must be lowercase. Uppercase names are unsafe (SDK #128), so our schemas use snake_case only.
- The Rabdi explorer's address page is a good way to prove writes. A direct link to an entity by key would help judges more (we show the entity link as `arkivUrl` in our API).
- Entities can expire before judging. We set lifetimes of at least 7 days for demo entities (see [`how-you-use-arkiv.md`](how-you-use-arkiv.md)).

## What we would build with a fix

If #1 and #3 were fixed, a whole PaisaLink environment (wallet, key, seeded data) could be created by one script. That is the difference between a 15-minute and a 1-hour setup for a new team.

## Builder's own notes

_To be written by the builder (aarjn): your honest experience, not the agents'. What did the hub feel like? What took longest? What surprised you? Keep it short and specific._

- TODO(owner): time from "start" to "first entity on the explorer", with the real clock times.
- TODO(owner): what you would change first.
- TODO(owner): booth conversation notes (outages, tGLM top-up, Swarm stamps).
