# Reach: who is PaisaLink for, and would they use it?

Criterion: *Who is it for, and would they use it? Can they try it today, and will you keep building it after Mumbai?*

## Who it is for

1. **Indian freelancers and small exporters who bill clients abroad.** They lose roughly 3 to 6 percent of each invoice to fees and currency spread, then wait days. (The figure is the builder's working number. `TODO(owner): add a source or soften.`) A USDT invoice with a link fixes both.
2. **Their clients abroad.** They need a link they can pay from a phone, with no gas token, no seed phrase and no network picker. PaisaLink asks them to tap Pay.
3. **Their accountants.** They need a clean list of invoices and payments with tx links. The CSV export gives that.
4. **Small investors or buyers of invoices.** An exporter with a 30-day invoice can sell it for cash today. An allowlisted investor funds it at a discount.
5. **Shops and apps that want to accept USDT.** A 19-line widget drops into a separate store.

## Why they would use it

- They already have the pain: foreign payments are slow and expensive.
- They don't have to learn crypto. The merchant makes a link. The client taps Pay.
- Refunds and exports are one click. These are what a payment link normally lacks.
- Their data stays theirs to read: every record is an Arkiv entity that anyone can query and that expires on a schedule that fits the business.

## Can they try it today?

- **Yes, on testnet.** The app runs on Whitechain Sepolia, Arkiv Rabdi and World ID staging. No real money is involved.
- Live app: <https://paisalink.tailcdec7a.ts.net>. Try it: open <https://paisalink.tailcdec7a.ts.net/merchant> to create an invoice, then open the pay link on a phone. `/demo-store` shows the widget, `/invest` the notes, `/onboard` World ID. This is Whitechain testnet only. The demo faucet's test USDT is nearly used up, so a judge may not be able to complete a payment; the demo video shows the full live flow.
- **Judges can reproduce it from the repo** in a few commands (README, "Setup from a clean machine").
- **A judge can query the data without us.** `bun run scripts/query.ts` reads our entities straight from Arkiv:

  ```bash
  bun install && bun run scripts/query.ts
  ```

- **Demo helpers exist so a first-time user is not blocked.** `/demo/fund` gives a demo payer test USDT. The "demo compliance desk" allowlists a demo investor. Both are labelled testnet shortcuts (README, "Live vs demo shortcuts").

## Will we keep building it?

`TODO(owner): say honestly what you plan.` Suggested honest answer: the builder wants to continue if a real freelancer or exporter agrees to pilot it. What we would do next, in order:

1. Move to Whitechain mainnet when it launches (the sponsor says mainnet arrives in November), with real USDT.
2. Replace the single Arkiv writer with merchant-owned entities, so each merchant controls its own records.
3. Pay-by-link for recurring invoices (renewals), using entity expiry as the billing cycle.
4. Real compliance: KYC for investors before the allowlist, instead of the demo desk.
5. Our own Swarm postage batch.
6. A security review of the contracts.

## Honest limits on reach

- It is testnet only today. Nobody has paid a real invoice with it.
- We have had no user interviews. `TODO(owner): list anyone you showed it to, even informally, and what they said.`
- The 3 to 6 percent figure is not measured by us.
