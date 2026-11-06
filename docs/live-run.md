# Live testnet run (S4)

Run started 2026-11-06 11:07 IST, ended 11:15 IST. Result: **FAILED at spec step 2-4** (one run only, as instructed; not re-run).

Spec results: 0 preconditions PASS (1.2s), 1 create invoice A PASS (20.9s), 2-4 pay gaslessly FAIL (8.0m timeout), steps 4-8 did not run.

## Cause
The spec checks for the "Get test USDT" button with an 8 s timeout. On the pay page the payer balance shows "Balance: ..." for longer than that, and the button shows as a disabled "Pay 4.90 USDT". The spec concluded the payer was funded and skipped the faucet. The balance then resolved to 0 and the "Get test USDT" button appeared, but nobody clicked it. The spec waited on the disabled pay button until the 480 s timeout. This is a spec/app race, not a chain failure. No faucet grant was made (`grants: 0`) and no USDT was spent.

## Evidence
| Step | What it shows | Tx hash | Explorer | Status |
|---|---|---|---|---|
| Invoice A create (4.90, `e2e invoice A mw4jlyby`) | merchant creates invoice | Whitechain tx hash not exposed by `/invoices/:id`; invoiceId `0x62f167a29f8eb56307a72f228f287b89545aec4903a5473468f2638d49a72945` | n/a | invoice state `open` per API (not verified by receipt) |
| Gasless pay | not reached | - | - | NOT RUN |
| Refund | not reached | - | - | NOT RUN |
| Note issue / fund / escrowed pay / settle | not reached | - | - | NOT RUN |
| Rule refusal | not reached (reverts in simulation, no tx) | - | - | NOT RUN |

Earlier, unrelated: W8 dry-check invoice `0x92314a9d...002e` (1 USDT, unpaid).

## Arkiv entities (written by the API, not read back with query.ts)
- Invoice A: https://rabdi.explorer.arkiv.network/entity/0x443da483846d475059005d692410fe8353a907c451d6b264ea8cedff1e7600de (create tx `0x74403e1949207b1697d0ddb009406fb9d525608f6fe44de4da861b5d5155ff01`)
- W8 dry-check invoice: https://rabdi.explorer.arkiv.network/entity/0x298c043c93a04fd2abc539b7f7ea1e05aae9de2287597df683f0899609e6a540
- Merchant profile: https://rabdi.explorer.arkiv.network/entity/0x3e3ea5c0eb83e4008c5a27cd9b4684c532ff608fbc03fc3c1d00377a972b824c

## Screenshots
- apps/web/e2e/screenshots/desktop-live-1-created.png
- apps/web/e2e/screenshots/desktop-live-2-pay.png (disabled pay button, balance still loading)

## Balances after the run
Deployer / demo faucet USDT: 7.322834 (unchanged). Demo payer (browser-local `0xa4a5...9C1D`): 0.
