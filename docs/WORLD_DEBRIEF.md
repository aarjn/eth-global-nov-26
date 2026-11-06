# World IDKit integration debrief (PaisaLink)

World asked for an integration debrief covering time to first success, friction, a missing capability and one improvement. This file holds that debrief and the running log we kept while building. SDKs: `@worldcoin/idkit` 4.6.0 (React widget) and `@worldcoin/idkit-core` 4.6.0 (which pulls in `@worldcoin/idkit-server` 1.2.0). We used staging and the simulator.

## The product decision: which credential, and why

- **The trust moment.** A merchant asks PaisaLink to pay the gas for its customers. Our relayer spends real WBT on every customer payment, up to 0.02 WBT per merchant per day. If one person can open many merchant accounts, they can drain the relayer.
- **The credential is Proof of Human (Orb, `proof_of_human`, issuer schema 1).** The rule is one human, one merchant account, one sponsored gas budget. The nullifier is scoped to our RP and the action `paisalink-merchant`, so the same person can't verify a second merchant wallet. That second attempt returns `409 NULLIFIER_REUSED`.
- **Why not device-level.** A device check is cheap to repeat, so it doesn't stop one person from running many accounts. It would not protect the gas budget.
- **Why not passport, MNC or Selfie Check.** They reveal more than we need, such as nationality, age or a face match. Paying someone's gas doesn't depend on any of those, so Proof of Human is the minimum sufficient assurance.
- **How it improves the product.** A verified merchant's customers pay in USDT without holding gas, seeing a chain name or writing down a seed phrase. An unverified merchant still gets paid through the self-paid `pay()` path, where the customer pays the gas. The credential unlocks a subsidy. It is not a login.
- **Privacy.** The Arkiv merchant entity gets a single flag, `verified = 1`. Nullifiers stay in `.data/nullifiers.json` on the API server, which is git-ignored and never written to Arkiv. The signal is the merchant wallet, so a proof can't be replayed for another wallet.

## How it works

1. `/onboard?wallet=0x..` calls `GET /world/request?wallet=`. The API signs a fresh RP context with `signRequest({ signingKeyHex, action, ttl: 300 })` from `@worldcoin/idkit-core/signing`. The signing key never leaves the server.
2. The page renders `IDKitRequestWidget` with these settings:
   - `environment: "staging"`
   - `constraints: CredentialRequest("proof_of_human", { signal: wallet })`
   - `allow_legacy_proofs: false`
3. In `handleVerify`, the page posts the unmodified `IDKitResult` to `POST /world/verify`. The API then runs these steps:
   1. It checks the environment, the action and the credential. Only Proof of Human with issuer schema 1 passes.
   2. It checks that `signal_hash == hashSignal(wallet)`.
   3. It checks that the nullifier is new.
   4. It forwards the result unchanged to `https://developer.world.org/api/v4/verify/{rp_id}` and requires `success: true` with the expected environment, action and nullifier.
   5. It reserves the nullifier, calls `store.setMerchantVerified(wallet, true)` (an Arkiv write) and notifies the dashboard.
4. **Failure paths:**

   | What happens | Result |
   |---|---|
   | Dialog closed, World App rejects, or the portal rejects | The page shows "Gas-sponsored checkout locked: verification not completed" and the self-paid fallback. The relayer keeps answering `MERCHANT_NOT_VERIFIED`. |
   | Same human tries a second wallet | `409 NULLIFIER_REUSED` |
   | Device or passport proof | `400 WORLD_WRONG_CREDENTIAL` |
   | Proof made for another wallet | `400 WORLD_SIGNAL_MISMATCH` |
   | World env vars missing | `503 WORLD_NOT_CONFIGURED`, and the page says so |
   | Arkiv write fails after World said yes | `503 STORE_UNAVAILABLE`. The nullifier stays `pending` for that wallet only, and "Finish saving" retries without asking World again. |

## Time to first success

- From reading the 4.6.0 type definitions to a green API test suite took about 10 minutes (08:32 to 08:41 IST, 6 Nov 2026). That covers RP signing, the verify wrapper, the nullifier store and 19 tests, including a check that the RP signature recovers to the signing key's address.
- **First real simulator verification: done (6 Nov 2026, ~10:41 IST).** With the Developer Portal app configured, the demo merchant went from `verified:false` to `verified:true` on the first try with no code changes. From the click on "Verify with World ID" to the Arkiv write finishing took about 11 s (RP request `created_at` 1793941489, nullifier `verifiedAt` 1793941500), including the scripted paste into the simulator. The persisted flag was then read straight from the Arkiv RPC: entity `0x3e3ea5c0eb83e4008c5a27cd9b4684c532ff608fbc03fc3c1d00377a972b824c` has `verified = u64 1`. Replay, cancel and relay-refusal were verified live by `apps/web/e2e/world-live.spec.ts` (see the live-run findings below).

## Friction (what we hit)

1. **No server-side verify helper in the JS SDK.** `idkit-core` 4.6.0 exports `signRequest`, `hashSignal` and `Nullifier`, but nothing that verifies a proof. Verification is a raw `fetch` to the Developer Portal. The verify response has no exported TypeScript type, so we had to read the API reference to learn `success`, `nullifier`, `environment`, `results[]` and `code`/`detail`.
2. **Two different hostnames.** The `idkit-core` README posts to `developer.worldcoin.org/api/v4/verify/...`, while the docs and `SKILL.md` use `developer.world.org`. We used `developer.world.org`.
3. **Signal binding is left to the integrator.** The docs say the backend "should enforce the same value" for the signal, but they don't say how. The portal verifies the proof against whatever `signal_hash` the body carries, so a backend that skips its own `signal_hash == hashSignal(expected)` check would accept a valid proof made for a different wallet. We found that `hashSignal` decodes 0x-hex strings as bytes, which makes checksummed and lowercase addresses hash the same. That is good, but it isn't documented.
4. **The nullifier format is ambiguous.** The v4 type comment says "RP-scoped nullifier (decimal)", the integrate guide says 0x-prefixed hex, and v3 proofs are hex. The `Nullifier` class (`fromHex`, `fromCanonicalString` with the `nil_` prefix) helped. We normalize every form to a decimal string before the uniqueness check.
5. **The `ProofOfHuman` preset implies legacy fallback.** The preset is documented as "4.0 with legacy Orb fallback", and `SKILL.md` says to pass `allow_legacy_proofs: true` with it. The SDK comment then warns that you "must track both v3 and v4 nullifiers to prevent double-claims", and one human can produce one of each. For a one-human-one-budget rule, that is a sybil hole unless you link them. We used `CredentialRequest("proof_of_human")` with `allow_legacy_proofs: false` instead. `WORLD_ALLOW_LEGACY=1` switches to the preset if the simulator or World App can't produce 4.0 proofs.
6. **The widget's Retry reuses the same RP context.** `onRetry` in `IDKitRequestWidget` calls `resetFlow(); openFlow()` with the same `rp_context`. After the 5-minute TTL that should fail as `rp_signature_expired` or `duplicate_nonce`. Our "Try again" closes the widget and fetches a fresh signature.
7. **Host verification errors are flattened.** When `handleVerify` throws, the widget reports only `failed_by_host_app`, so the host's reason (for example "already used") never reaches the widget UI. We keep our own error state and show the exact reason on the page.
8. **The error for an unknown RP id is misleading.** We sent a real `POST /api/v4/verify/rp_0000000000000000` with a dummy RP id. It returned HTTP 400 `{"code":"app_not_migrated","detail":"This app has not been migrated to World ID 4.0. Please use the v2 verify endpoint.","attribute":null,"app_id":"rp_0000000000000000"}`. A missing or mistyped RP id reads like a migration problem. The body also has no `success` field, even though the reference marks it as required, and it has an `attribute` field the reference doesn't mention. Our check treats anything other than `success: true` as a rejection.
9. **Portal setup can't be done by an agent.** Creating the app, action and RP signing key happens in the Developer Portal behind a human sign-in. The signing key is shown once. This step blocks everything after the unit tests.

### Live-run findings (simulator + staging, Playwright)

10. **The 4.0 simulator gives every identity the same Proof of Human nullifier.** Identities #0-#5 and the identities after "Reset simulator" all produced nullifier `0x061481f7bf43...` for our RP and action. So the simulator can verify exactly one merchant wallet per action, ever; every later run is a replay and gets `409 NULLIFIER_REUSED` (correct behaviour, but you can't demo a second success). Fix: use a new action for each demo run, or a real World App. We kept the one success slot for the demo merchant.
11. **The simulator's Cancel is silent.** After pressing Cancel in the simulator sheet, IDKit stays on "Connecting... Please continue in app" for as long as we waited (20 s+, the bridge keeps polling `bridge.worldcoin.org/response/<id>` with HTTP 200). The real World App sends `verification_rejected`, the simulator doesn't. The only exit is the widget's close button, which our page turns into the locked banner ("You closed the World ID check before it finished."). A cancel in the simulator therefore cannot be automated as a rejection.
12. **Simulator mechanics are undocumented.** The connect link on "Use the simulator" is `https://simulator.worldcoin.org?connect_url=<encoded staging.world.org/verify?...>`; it always lands on the default identity (#4, `/id/0x18310f83`). Typing a made-up `/id/0x...` gives console `No active identity`; identities exist only after the root page loaded once. The "Paste code" box submits on paste with no Continue press. Credential chips in the "Complete verification" sheet are disabled, and with a `proof_of_human` request the sheet's summary line read "Unique device" even though the response carried `proof_of_human`, `issuer_schema_id: 1`, protocol 4.0. That reads like a wrong credential and is confusing.
13. **A "will change with World ID 4.0" banner** is shown on the simulator while it already returns 4.0 proofs (there is a "Legacy v3 proof / World ID 4.0" toggle, 4.0 was the default).
14. **IDKit's verify screen is slow to leave.** After the proof is sent, the dialog shows "Transmitting verification to host app. Please wait..." for as long as our `handleVerify` runs, which includes the Arkiv write (several seconds). Do the slow write after returning if the UX matters.

## Missing capability

There is no server SDK function such as `verifyUniquenessProof(result, { rpId, action, environment, expectedSignal })` that does all of the following:

- calls the portal
- checks `signal_hash`, action and environment against what the RP asked for
- returns a typed result with a normalized nullifier (as `Nullifier`)

Every integrator currently rewrites these checks by hand, and the signal check is the one most likely to be missed.

## One improvement

Ship that helper in `@worldcoin/idkit-core/verify` (or `idkit-server`), together with a typed `VerifyResponse` and a one-paragraph "binding the signal" section in the integrate guide. That would have removed friction items 1 to 4 for us.

## Running log (IST, 6 Nov 2026)

Times are approximate between the 08:32 install and the 08:41 clock check, when all steps below were done.

- 08:32 Installed `@worldcoin/idkit-core@4.6.0` (api) and `@worldcoin/idkit@4.6.0` (web), with exact pins. `idkit-server` 1.2.0 came in transitively.
- ~08:33 Read `index.d.ts`, `signing.d.ts`, `hashing.d.ts`, `nullifier.d.ts` and the widget/hooks `.d.ts`. Confirmed the v4 types `RpContext`, `IDKitResult` and `IDKitRequestWidget` (controlled `open`/`onOpenChange`, `handleVerify`). The v1/v2 tutorials don't apply.
- ~08:34 Probed in bun:
  - `signRequest` returns `{sig, nonce, createdAt, expiresAt}` and accepts a key with or without 0x.
  - `hashSignal` gives the same hash for checksummed and lowercase addresses.
  - `Nullifier.fromHex("12345")` parses the string as hex, so decimal input needs care.
- ~08:35 Read `docs.world.org/world-id/SKILL.md`, the integrate guide and the `POST /api/v4/verify/{rp_id}` reference. Learned the success/error shapes and `all_verifications_failed`.
- ~08:36 `apps/api/src/world.ts` written: config, RP signing route, verify wrapper, nullifier store and routes.
- ~08:37 19 API tests green on the first run, including the signature-recovery test, the denied path ending in `MERCHANT_NOT_VERIFIED` on `/relay`, nullifier reuse, a second wallet with the same human, and Arkiv-failure resume. API typecheck clean. Full API suite: 67/67.
- ~08:38 Real API started with the empty World env. The plugin mounted, `/world/config` reported `configured: false`, and both `/world/request` and `/world/verify` returned `503 WORLD_NOT_CONFIGURED` with the names of the missing variables, never their values.
- ~08:40 `/onboard` page built: why-sentence, IDKit widget, verified badge, locked banner and self-paid fallback. Web typecheck, a Vite production build and 4 page tests passed. The web app reads the app id from `GET /world/config`, so `VITE_WORLD_APP_ID` is optional.
- ~08:41 World secrets not yet in `lechu-secret`. The real simulator run is blocked on the Developer Portal app.
- ~08:41 Sent a real request to the portal with a dummy RP id and got `400 app_not_migrated` (friction item 8). This confirms the endpoint, the hostname and the error shape.
