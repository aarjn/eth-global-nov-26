# Live testnet run (S4)

Run 1 (11:07 IST) failed at the pay step: the spec skipped the faucet because the payer balance was still loading (fixed in 02932c9).

Run 2 started 2026-11-06 11:18 IST, ended about 11:22 IST. Result: **7 of 8 spec tests passed; the finance test (8) failed.** Not re-run.

## Spec results
| Test | Result |
|---|---|
| 0 preconditions | pass |
| 1 create invoice A (4.90) | pass (20.4s) |
| 2-4 faucet, gasless pay | pass (38.1s) |
| 4 dashboard shows Paid | pass |
| 5 partial refund 0.90 | pass (25.3s) |
| 6 CSV download | pass |
| 7 publish PDF to Swarm | pass (8.6s) |
| 8 finance invoice B | **fail**: `getByText(/Listed as note #\d+/)` not found in 120 s |

## Why test 8 failed
The note was issued on chain and in Arkiv (note #1, invoice B, face 1, price 0.95, state `issued`). The page, however, showed "This invoice is already listed as note #1 (issued). See it below." The spec waits for the text "Listed as note #N", so it never matched. The sale itself worked and the page changed its wording. The cause is most likely a spec wording mismatch or a UI re-render that replaced the success message. This is not confirmed. The investor-fund, escrowed-pay, rule-refusal and settle steps did not run.

## Transactions (Whitechain, all verified with `cast receipt`, status 1)
| Step | What it shows | Tx hash | Explorer | Status |
|---|---|---|---|---|
| Invoice A create (4.90) | merchant creates invoice on PaymentRouter | 0x3304b1cb83019416a0cc72f2523c550858bcd47afcd8b5368878467d2d61cd75 | https://explorer.testnet.whitechain.io/tx/0x3304b1cb83019416a0cc72f2523c550858bcd47afcd8b5368878467d2d61cd75 | 1 |
| Gasless pay 4.90 | payer signs, relayer pays gas | 0x9957efd2d6d04ac8301c00990182dc0502c2899f0b58171b2c9cfa011f5c0c33 | https://explorer.testnet.whitechain.io/tx/0x9957efd2d6d04ac8301c00990182dc0502c2899f0b58171b2c9cfa011f5c0c33 | 1 |
| Partial refund 0.90 | merchant refunds payer | 0x0405f8d08472299c173a757d0ab59eb6d06b93ecb1b1491e71d8f9d2fb3c5335 | https://explorer.testnet.whitechain.io/tx/0x0405f8d08472299c173a757d0ab59eb6d06b93ecb1b1491e71d8f9d2fb3c5335 | 1 |
| Invoice B create (1.00) | invoice to be financed | 0x7c67b00a3c0cc7f9418fa03e37d7f0b26ab9f091bd3a3dfe3f1f20ce31b71d91 | https://explorer.testnet.whitechain.io/tx/0x7c67b00a3c0cc7f9418fa03e37d7f0b26ab9f091bd3a3dfe3f1f20ce31b71d91 | 1 |
| Note issue (#1, 1.00 face, 0.95 price) | invoice B sold as a note | 0x1aa3d9187194912ed5c8d9f12b306ddc3993b4398fcd1deb5ede02537e690dea | https://explorer.testnet.whitechain.io/tx/0x1aa3d9187194912ed5c8d9f12b306ddc3993b4398fcd1deb5ede02537e690dea | 1 |
| Investor fund | not reached | - | - | NOT RUN |
| Escrowed customer pay | not reached | - | - | NOT RUN |
| Rule refusal | not reached (reverts in simulation, no tx) | - | - | NOT RUN |
| Settle | not reached | - | - | NOT RUN |

The invoice-create hashes come from `InvoiceCreated` logs on the router, matched to the invoice id in the receipt topics. The API does not expose them.

## Arkiv entities (read back with `bun --env-file=.env.local scripts/query.ts`)
`query.ts` lists the 4 invoices and 1 payment. Invoice A is `paid` with its Swarm ref and paid_tx set. Invoice B is `open`. `/notes` (source: arkiv) returns note #1.
- Invoice A (paid): https://rabdi.explorer.arkiv.network/entity/0x2a687bca3e74ad2e7155e364a2bda5c7381b233df9fafd49357317c75f4ce648
- Payment A: https://rabdi.explorer.arkiv.network/entity/0x737cf1e14a1b84fcd0509916e2330243f7412e1f92292f53b5d572ad0f3e0d4e
- Invoice B: https://rabdi.explorer.arkiv.network/entity/0x9a9d018e145f44a822ec13e8d29c6b61865108881136eb97ac2158dfde019061
- Note #1: https://rabdi.explorer.arkiv.network/entity/0x2a38811789d1340c3363746f6fb9db3a6e8595a9b4328145c423408a37d66831
- Merchant: https://rabdi.explorer.arkiv.network/entity/0x3e3ea5c0eb83e4008c5a27cd9b4684c532ff608fbc03fc3c1d00377a972b824c

Left over from run 1 and W8: invoice `0x62f167a2…` (4.90, unpaid) and `0x92314a9d…` (1.00, unpaid).

## Screenshots (apps/web/e2e/screenshots/)
desktop-live-1-created.png, desktop-live-2-pay.png, desktop-live-2-paid.png, desktop-live-4-dashboard-paid.png, desktop-live-5-refund.png, desktop-live-7-swarm.png. There is no live-8 screenshot because the test failed before it.

## Balances after run 2 (USDT)
- Demo faucet / deployer: 2.422834 (was 7.322834)
- Demo payer 0xDDBe…918c: 0.90 (the refund)
- PaymentRouter: 4.00 (merchant balance, not withdrawn)
- Demo merchant wallet: 0
- InvoiceNote contract: 0 (no escrow)
