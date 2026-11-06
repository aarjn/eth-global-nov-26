# W3: web app + widget (Opus)

**Own:** `apps/web/**` except `src/routes/onboard/**` and `src/routes/invest/**`; plus `packages/widget/**`.

Build the Vite + React 19 + TypeScript + Tailwind v4 app from PLAN.md section 2 "Frontend" against the REST contract in section 3 (API at `VITE_API_URL`, default `http://localhost:8787`). Use `@paisalink/shared` for types, chain, USDT typed data, ABIs (W1 publishes ABIs around 10:15; W2 is building the API in parallel; code against the contract).

- `/merchant`: create invoice (amount in USDT, memo, due date), live list (poll or SSE/WebSocket if the API offers it; ask W2 via handoffs for a `/events` stream), state badges, one-click refund (merchant signs EIP-712; relayer submits; so the merchant needs no gas), "Export CSV", "Sell this invoice" link to `/invest` (W5 builds that page later), verification badge linking to `/onboard` (W6 builds it).
- `/pay/:id` (mobile-first, looks great on a phone): amount, merchant handle, Pay button. The payer wallet is a browser-local key ("testnet demo wallet", labelled) created on first visit; if it has no USDT, show "Get test USDT" calling `POST /demo/fund`. Signs `ReceiveWithAuthorization` (to = PaymentRouter, value = amount, validBefore = now+10 min, random nonce) and posts to `/relay`. Optional: an injected wallet (window.ethereum) path. Show "Paid" with the receipt link and an explorer link. Never mention chains, gas or crypto jargon in the main flow.
- `/r/:id`: public receipt (from the API/Arkiv), explorer link, "Open PDF on Swarm" link if `swarmRef` is set.
- `/demo-store`: a separate fake shop page that integrates `<PaisaLink amount="49" merchant=... onPaid=... />` in about 20 lines; also display that source code on the page (the video shows it).
- `packages/widget`: `@paisalink/react` component (opens `/pay/:id` in a modal/iframe after creating an invoice via the API) + `embed.js` script-tag loader.
- Clean, modern, trustworthy design (judges score UX): Indian freelancer/exporter persona, INR-friendly copy ("₹ ≈" helper optional), big numbers, clear states. Keep it fast.
- `bun run dev` / `bun run build` must work. Add a few component tests if cheap.
