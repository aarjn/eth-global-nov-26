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

## Run 3 (recording)
Started 2026-11-07 01:24 IST, ended 01:33 IST (pick-up shots to 01:35). Script: `apps/web/e2e/record/record-demo.ts` (Playwright library, Chromium, video only, no trace). **Every chapter passed on the first run**, including the finance flow that failed in run 2: list, fund, escrowed customer payment, rule refusal and settle. Amounts were kept small: invoice A 1.00, partial refund 0.20, invoice B face 0.50 sold for 0.45, maturity "5 minutes (demo)". Clips are in `recordings/` (git-ignored; see `recordings/README.txt`).

### Transactions (Whitechain, all checked with `cast receipt`, status 1)
| Step | What it shows | Tx hash | Explorer | Status |
|---|---|---|---|---|
| Invoice A create (1.00) | merchant creates invoice on PaymentRouter (relayer sends) | 0xcd2f292049c0d1413d33cbc650eda19480fcce9db1d0bc8eb38132a749413721 | https://explorer.testnet.whitechain.io/tx/0xcd2f292049c0d1413d33cbc650eda19480fcce9db1d0bc8eb38132a749413721 | 1 |
| Faucet to payer A (1.00) | demo faucet sends test USDT to the fresh payer | 0x36e7b53bd5e03b5c3c36deca1aa2b19dae2258d80cd56c5c1afeb2f5cf0c5698 | https://explorer.testnet.whitechain.io/tx/0x36e7b53bd5e03b5c3c36deca1aa2b19dae2258d80cd56c5c1afeb2f5cf0c5698 | 1 |
| Gasless pay A (1.00) | payer signs, relayer calls payWithAuthorization | 0x0f89c838aacf418f6b020e4b58e5dca368109d53bf716a5463b493af89a3bf75 | https://explorer.testnet.whitechain.io/tx/0x0f89c838aacf418f6b020e4b58e5dca368109d53bf716a5463b493af89a3bf75 | 1 |
| Partial refund 0.20 | merchant refunds the payer | 0x97f679d331148c9b9c90975eb161e774e97fb1f02c2f2d0eb905d15a44a0eb8f | https://explorer.testnet.whitechain.io/tx/0x97f679d331148c9b9c90975eb161e774e97fb1f02c2f2d0eb905d15a44a0eb8f | 1 |
| Invoice B create (0.50) | invoice to be financed | 0x886b77138697a53dcd6433369a625b19d216f6380a1e3d93b6cb15e9cc13fe74 | https://explorer.testnet.whitechain.io/tx/0x886b77138697a53dcd6433369a625b19d216f6380a1e3d93b6cb15e9cc13fe74 | 1 |
| Note issue (#2, face 0.50, price 0.45) | invoice B listed as a note (merchant signs, relayer sends) | 0x036643ed5c9d83bbb053f60100adbf7756681580e31326e91e6cdcf10b567961 | https://explorer.testnet.whitechain.io/tx/0x036643ed5c9d83bbb053f60100adbf7756681580e31326e91e6cdcf10b567961 | 1 |
| Investor allowlist | demo compliance desk allowlists the fresh investor | 0x2c0fd232c95bbe9cee83877318be3d3d1f8f10e6da9f9575ba7553531f15ebb6 | https://explorer.testnet.whitechain.io/tx/0x2c0fd232c95bbe9cee83877318be3d3d1f8f10e6da9f9575ba7553531f15ebb6 | 1 |
| Investor gas | test WBT for the investor's own gas | 0xcc3caac880b8197b611b0d15e87a3106a275fa67aada36eab571d9d5615030ad | https://explorer.testnet.whitechain.io/tx/0xcc3caac880b8197b611b0d15e87a3106a275fa67aada36eab571d9d5615030ad | 1 |
| Faucet to investor (0.45) | test USDT for the note price | 0xe6447af10ea03961d8a7501bc69ec3112c3fa07fa40188e1fb81c99c3ef857d6 | https://explorer.testnet.whitechain.io/tx/0xe6447af10ea03961d8a7501bc69ec3112c3fa07fa40188e1fb81c99c3ef857d6 | 1 |
| USDT approve | investor approves InvoiceNote | 0x40b4fac96fd250aa4d2e9e0fdf0bc31f0733faa2134043570649ee594f6e30ab | https://explorer.testnet.whitechain.io/tx/0x40b4fac96fd250aa4d2e9e0fdf0bc31f0733faa2134043570649ee594f6e30ab | 1 |
| Investor fund | investor buys note #2, 0.45 USDT to the merchant | 0xaa8ffc9cc5ca53cd368b149ea0d75ede6e8fcfb0e76a01a1965b39e5f7f52636 | https://explorer.testnet.whitechain.io/tx/0xaa8ffc9cc5ca53cd368b149ea0d75ede6e8fcfb0e76a01a1965b39e5f7f52636 | 1 |
| Faucet to payer B (0.50) | test USDT for the customer of invoice B | 0x469da61fc54b90f676ea15436f010b8fb59df3c88cf1fb0b7bc5940a2b44acd8 | https://explorer.testnet.whitechain.io/tx/0x469da61fc54b90f676ea15436f010b8fb59df3c88cf1fb0b7bc5940a2b44acd8 | 1 |
| Escrowed customer pay B (0.50) | gasless pay; router forwards the USDT to the note escrow | 0xfff0ea707fe1e2dbda5aaaf4afb3b1b000f4d0db3cdb70fdd5a29abb6102daf8 | https://explorer.testnet.whitechain.io/tx/0xfff0ea707fe1e2dbda5aaaf4afb3b1b000f4d0db3cdb70fdd5a29abb6102daf8 | 1 |
| Rule refusal | transfer after maturity, simulated from the holder's wallet | - (reverts, no tx) | UI: `Reverted: MaturityPassed(1793995359)` | revert |
| Settle note #2 | after maturity the holder receives the 0.50 face value in USDT | 0x5f203b7f7be1e072ba58f189ea2165d07de1944e1fc26e81e3be4fa83d3251a0 | https://explorer.testnet.whitechain.io/tx/0x5f203b7f7be1e072ba58f189ea2165d07de1944e1fc26e81e3be4fa83d3251a0 | 1 |
| Unverified merchant invoice (ch10) | invoice for the fresh unverified merchant; its gasless relay was refused | 0x5c76fdda623f96ebf373e4e35cef86a6fde731a077dfc2fdde242b4e8cd9af03 | https://explorer.testnet.whitechain.io/tx/0x5c76fdda623f96ebf373e4e35cef86a6fde731a077dfc2fdde242b4e8cd9af03 | 1 |

Invoice-create hashes come from the router's `InvoiceCreated` logs matched to the invoice id; faucet hashes from USDT `Transfer` logs from the deployer. The relay for the unverified merchant returned `403 {"code":"MERCHANT_NOT_VERIFIED"}` (no tx).

### Arkiv entities (Rabdi), read back through the API
- Invoice A (paid, swarm_ref set, version history shown in ch09): https://rabdi.explorer.arkiv.network/entity/0x72249e020a49f82752de2c18081219ea6900e55b305ecafea7858b6800540235
- Payment A (with refund_tx): https://rabdi.explorer.arkiv.network/entity/0x4b17ef90296dbd05e6f50f50525cfef9ac9ea6758e94823b95743210f39f3f3e
- Invoice B (settled): https://rabdi.explorer.arkiv.network/entity/0xcb2c86cbc2c7f9123a52ba6e2372e8e3aaae13e90e8e22eb730a1d06261b5b68
- Payment B: https://rabdi.explorer.arkiv.network/entity/0xd3296060175861d9a10982781642057cd4334d9ff0dbb270a97d8196ffe762e4
- Demo merchant @priya.designs (verified): https://rabdi.explorer.arkiv.network/entity/0x3e3ea5c0eb83e4008c5a27cd9b4684c532ff608fbc03fc3c1d00377a972b824c
- Fresh unverified merchant 0xB3818239766CC3b8dFF5091Fca3e752c56e78d55 (verified=false): https://rabdi.explorer.arkiv.network/entity/0xa85b65312ae8a96b56724080bd6b4900fb2cabf7ddb20a904d9045469b979159
- Note #2: `/notes` (source: arkiv) returns it as settled; the API exposes no entity URL for notes.

Swarm PDF of invoice A: https://api.gateway.ethswarm.org/bzz/531b98a17a59319b450edcac41b8bdd58e4e25f7cadc4fa7411abe181be9e7f0/

### Balances after run 3 (USDT)
- Demo faucet / deployer: 0.472834 (was 2.422834; spent 1.95 = payer A 1.00 + investor 0.45 + payer B 0.50)

### Notes
- No app code was changed for the recording.
- ch08's first take ended with the settled note pushed below the fold, and the Arkiv record link is not shown on a paid invoice row, so two short no-spend pick-up shots (settled card + settle tx; invoice A's Arkiv entity) were recorded right after and appended to ch08 and ch09.
