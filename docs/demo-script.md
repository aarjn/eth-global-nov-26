# Demo script (3:00)

Read this aloud in your own voice. The video must use your real voice, not text-to-speech. Footage is a real-time screen recording at 1080p, with no speed-up. ETHGlobal accepts 2 to 4 minutes. This script is timed to 3:00.

How to use it: record the audio one chapter at a time, so a bad take only costs one chapter. Speak at a calm pace, about 2.5 words a second. Each chapter has a time budget. If you run over, cut a sentence, don't talk faster.

Amounts on screen: the recording uses an invoice of 1.00 USDT, a refund of 0.20, a note with face value 0.50 sold for 0.45, and a maturity of 5 minutes (demo setting). The narration says these amounts.

## Narration and shot list, side by side

| # | Time | Narration (read this) | On screen (shot list) |
|---|---|---|---|
| 1 | 0:00 to 0:14 | A freelancer in India bills a client abroad. Banks and cards take three to six percent, and the money takes days. PaisaLink gets them paid in USDT, and the client has nothing to learn. | Title card: **PaisaLink**, then the big number "3 to 6 %". Cut to `/merchant`. |
| 2 | 0:14 to 0:28 | I create an invoice for one USDT. It becomes an entity on Arkiv. Arkiv is our only database. And I get a payment link. | `/merchant` (demo merchant, "testnet demo wallet" tag visible). Fill amount (1.00), due date, note. Click Create. The link appears. Copy it. |
| 3 | 0:28 to 0:55 | The client opens the link on a phone. They tap Pay. No gas. No seed phrase. No chain name. They only sign a message. Our relayer sends it to the official USDT on Whitechain and pays the fee. Here is the transaction on the explorer. | Phone view of `/pay/<id>` (browser phone emulation, 390 px wide). Tap Pay. "Paid" screen. Then the explorer tab with the USDT tx. Point at `receiveWithAuthorization` / the USDT token transfer and the relayer as sender. |
| 4 | 0:55 to 1:10 | The dashboard updated by itself. It reads Arkiv live. Now a refund: twenty cents back to the client, in one click. The router only sends it back to whoever paid. | Back to `/merchant`, window side by side if possible: status flips to Paid without a reload. Click Refund, enter 0.20, confirm. Show the refund tx link. |
| 5 | 1:10 to 1:22 | The accountant gets a CSV with every invoice and every transaction link. And a separate shop can add this checkout in nineteen lines. | Click **Export CSV**; open the file in a spreadsheet. Quick cut to `/demo-store` with `StoreCheckout.tsx` source on screen. |
| 6 | 1:22 to 1:42 | Now the exporter wants cash today. They sell a note with a face value of fifty cents, for forty-five. Only an approved investor can fund it, in USDT. The money reaches the merchant in one transaction. | `/merchant`: **Sell this invoice**. `/invest`: issue the note. Switch to the investor view (demo investor wallet, "demo compliance desk" tag in view). Click Fund. Show the fund tx. |
| 7 | 1:42 to 1:57 | Now the rule. In this demo a note matures in five minutes, and that time is up. The investor tries to transfer it. The contract says no. This rule lives in Solidity, not in the app. | `/invest`: after the maturity timer ends, click **Transfer** (the "transfer after maturity" button). Show the revert reason `MaturityPassed`. Hold on it for two seconds. |
| 8 | 1:57 to 2:07 | Maturity passed, so settle works. The investor is paid the full face value, fifty cents, in USDT. One full lifecycle, on chain. | Click **Settle**. Show the settle tx link and the note state turning to Settled. |
| 9 | 2:07 to 2:17 | The receipt is a PDF on Swarm. The Arkiv entity holds only the reference. The file is on Swarm, and the pointer is on Arkiv. | `/r/<id>`: click **Open PDF on Swarm**, the PDF opens from the gateway. Cut to the Rabdi explorer entity page, highlight `swarm_ref`. |
| 10 | 2:17 to 2:42 | Who may spend our gas? One human, one budget. This merchant is already verified with World ID, Proof of Human. The badge shows it. Now a second merchant cancels the check. The gasless path stays locked, and the relayer refuses. They can still pay with their own wallet. | `/onboard` for the demo merchant, who is already verified: the "Verified" badge. Then merchant B (a fresh browser profile): open IDKit, close it. Show the "Gas-sponsored checkout locked" banner and a relay attempt answering `MERCHANT_NOT_VERIFIED`. |
| 11 | 2:42 to 3:00 | Without Whitechain, there is no USDT settlement and no rules. Without Arkiv, there is no data. Without Swarm, no lasting receipt. Without World, anyone can drain our gas. Next: mainnet, real compliance checks, and merchant-owned data. Thank you. | Architecture diagram (from the README) with four logos or labels. Last frame: repo URL and "Everything shown is live on testnet." |

About 360 spoken words in total. Every chapter stays under 2.5 words a second.

## Chapter audio files

Record one file per chapter and name it `ch01.m4a` to `ch11.m4a`. The coordinator joins them with the video. Two or three takes each.

## Before you record (prep checklist)

1. The API and web app are running. `GET /health` shows `ok: true`, a relayer WBT balance and Arkiv `canWrite: true`.
2. The demo payer has test USDT at least equal to the invoice (1.00), and the investor has the note price (0.45). Use `scripts/fund-demo.ts`.
3. The demo investor has been allowlisted through the demo compliance desk, and has some WBT for gas.
4. The demo merchant is already World ID verified (the badge take). Have a second, fresh browser profile ready for the cancelled take.
5. Browser at 1920 x 1080, zoom so text is readable. Hide bookmarks and notifications.
6. Tabs ready: `/merchant`, a phone-emulated `/pay/<id>`, the explorer, the Rabdi explorer, `/invest`, `/onboard`, `/demo-store`.
7. Note maturity is 5 minutes (demo setting). Start the note before chapter 6 so the maturity timer has ended by chapter 7, or record 6, 7 and 8 as separate takes.
8. Every shortcut is labelled on screen: "testnet demo wallet", the faucet label, the compliance desk label. Don't hide them.

## Rules for the recording

- Real time. No speed-up. If a transaction takes ten seconds, cut the dead time in editing, but never fast-forward and never fake a result.
- 1080p screen recording. No phone-camera footage.
- No background music over the narration.
- Show each party: merchant (chapters 2, 4, 5), payer (3), investor (6 to 8).
- Show the World ID cancelled path (chapter 10).
- Show the Swarm moment (chapter 9).
- Say "testnet" once, near the start or the end.

## If something fails during recording

| Failure | What to do |
|---|---|
| Relayer returns `BUDGET_EXCEEDED` or `RATE_LIMITED` | Wait, or use a fresh demo merchant. Say nothing false: you can show the code on screen and say it is the drain protection working. |
| Arkiv read looks stale | Wait one block (about 2 seconds) and refresh. The dashboard also polls every 4 seconds. |
| World simulator is down | Record the cancelled path first and the success path later. Never show a verified badge you didn't earn. |
| Swarm gateway is slow | Record chapter 9 as a separate take. If it is down, skip chapter 9 and say so in the README. |
| Maturity timer too short for your speech | Record chapter 7 as its own take right after the timer ends. |

## Timestamps for the README

The real v2 chapter start times (video 2:13, about 2:15) are in the "Video chapters" table in `README.md`. The times in the table above are the original plan.
