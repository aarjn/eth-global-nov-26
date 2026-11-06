# Arkiv SDK friction log (raw notes from the build, 6 Nov 2026)

Collected while building `packages/arkiv` on `@arkiv-network/sdk` 1.0.1 (Rabdi). Feeds `arkiv/friction.md`.

1. `predictEntityKey` is derived from the wallet nonce plus a salt, not from content, so it cannot make re-runs idempotent. We look entities up by our own id attribute instead.
2. The hub has no programmatic path: the faucet and access keys need an email account, a captcha and a session cookie. `GET /api/faucet` returns 401 even with a wallet signature.
3. Entity events carry only the key and owner, so an app must re-fetch each entity to learn which schema it belongs to.
4. There is no typed 429 error, and viem's default retry repeats a 429 three times, which can extend the `ANON_COST_LIMITED` lockout.
5. You can write values as bare strings, but reads return `{type, value}`, so the shapes don't match.
6. `dec` drops trailing zeros: "49.50" comes back as "49.5".
7. The typed `where()` breaks inside generic helpers, which need casts.
8. Extending an entity needs its current expiry block, because the node rejects any extension that would move the expiry earlier.
