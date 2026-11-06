# Contracts spec: PaymentRouter + InvoiceNote (W1)

Status: **interface frozen** (6 Nov, W1). Implementation: `contracts/src/`. Generated ABIs: `packages/shared/src/abi/{PaymentRouter,InvoiceNote}.ts` (`paymentRouterAbi`, `invoiceNoteAbi`, `as const`), regenerated with `bun run gen:abi`. Helpers (nonce, EIP-712 builders, enums): `packages/shared/src/abi/helpers.ts`. Addresses: `packages/shared/src/addresses.ts` reads `contracts/deployments/1874.json` (`deployed: false` until the deploy runs).

Toolchain: Solidity 0.8.28 (cancun), OpenZeppelin Contracts v5.4.0, forge-std v1.11.0, vendored under `contracts/lib/` (installed with `forge install --no-git` at pinned tags; no submodules).

All amounts are USDT base units (6 decimals): 49 USDT = `49000000`. `invoiceId` is a `bytes32` chosen off chain (the API generates it; Arkiv stores it as hex).

## Roles

| Role | Who | Can do |
|---|---|---|
| owner | deployer `0xf4a0…fDeb` | `setOperator`, `setNoteContract` (router); `setAllowed` (note: compliance officer) |
| operator | relayer `0x645b…DA8F` | `createInvoiceFor` (create invoices for merchants, so merchants never need gas) |
| merchant | invoice creator | `createInvoice`, `refund`, `withdraw`, `issue`; or sign `Refund`/`Withdraw`/`Issue` typed data for the relayer |
| payer | anyone | `pay` (self-paid), or sign an EIP-3009 `ReceiveWithAuthorization` that anyone submits via `payWithAuthorization` |
| investor | allowlisted address | `fund`, `transfer` (before maturity, to allowlisted) |
| anyone | | `payWithAuthorization`, `refundWithSig`, `withdrawWithSig`, `issueWithSig` (signature authorises), `repay`, `settle` |

## PaymentRouter

```solidity
constructor(address usdt, address owner, address operator)

enum Status { None, Open, Paid, Refunded, Withdrawn }           // 0..4
struct Invoice {
  address merchant; uint64 dueAt; address payer; uint64 paidAt;
  Status status; bool financed;
  uint256 amount; uint256 balance; uint256 refunded; uint256 noteId;
}

// admin
function setOperator(address operator) external;                 // onlyOwner
function setNoteContract(address noteContract) external;          // onlyOwner

// create
function createInvoice(bytes32 invoiceId, uint256 amount, uint64 dueAt) external;                       // merchant = msg.sender
function createInvoiceFor(bytes32 invoiceId, address merchant, uint256 amount, uint64 dueAt) external;  // onlyOperator

// pay
function pay(bytes32 invoiceId) external;                         // transferFrom(msg.sender) after USDT approve; gasless=false
function payWithAuthorization(
  bytes32 invoiceId, address from, uint256 value, uint256 validAfter, uint256 validBefore,
  bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external;        // USDT.receiveWithAuthorization(to = router); gasless=true
function paymentNonce(bytes32 invoiceId) external view returns (bytes32);   // = keccak256(abi.encode(router, invoiceId))

// refund / withdraw (merchant direct or relayer with merchant signature)
function refund(bytes32 invoiceId, uint256 amount) external;     // to the recorded payer, partial allowed, <= balance
function refundWithSig(bytes32 invoiceId, uint256 amount, uint256 deadline, bytes signature) external;
function withdraw(bytes32 invoiceId) external;                    // whole remaining balance to the merchant
function withdrawWithSig(bytes32 invoiceId, uint256 deadline, bytes signature) external;
function nonces(address merchant) external view returns (uint256);          // EIP-712 nonce for Refund/Withdraw

// financing hook (InvoiceNote only)
function markFinanced(bytes32 invoiceId, uint256 noteId) external;

// views
function getInvoice(bytes32 invoiceId) external view returns (Invoice memory);
function usdt() external view returns (address);
function operator() external view returns (address);
function noteContract() external view returns (address);
function owner() external view returns (address);
function DOMAIN_SEPARATOR() external view returns (bytes32);
function eip712Domain() external view returns (...);              // ERC-5267
function REFUND_TYPEHASH() / WITHDRAW_TYPEHASH() external view returns (bytes32);
```

Events:

```solidity
event InvoiceCreated(bytes32 indexed invoiceId, address indexed merchant, uint256 amount, uint64 dueAt);
event InvoicePaid(bytes32 indexed invoiceId, address indexed payer, uint256 amount, bool gasless);
event InvoiceRefunded(bytes32 indexed invoiceId, address indexed to, uint256 amount);
event Withdrawn(bytes32 indexed invoiceId, address indexed merchant, uint256 amount);
event InvoiceFinanced(bytes32 indexed invoiceId, uint256 indexed noteId);
event PaymentForwardedToNote(bytes32 indexed invoiceId, uint256 indexed noteId, uint256 amount);
event OperatorUpdated(address indexed operator);
event NoteContractUpdated(address indexed noteContract);
```

Custom errors (decode with the ABI; the UI can show the name): `ZeroAddress()`, `InvalidAmount()`, `InvoiceExists(bytes32)`, `InvoiceNotFound(bytes32)`, `InvoiceNotOpen(bytes32)`, `NotMerchant(address)`, `NotOperator(address)`, `NotNoteContract(address)`, `WrongValue(uint256 expected, uint256 got)`, `WrongNonce(bytes32 expected, bytes32 got)`, `ExceedsBalance(uint256 available, uint256 requested)`, `NothingToWithdraw(bytes32)`, `SignatureExpired(uint256 deadline)`, `InvalidSignature()`, `AlreadyFinanced(bytes32)`. USDT's own reverts surface as strings, e.g. `FiatTokenV2: authorization is expired`, `FiatTokenV2: authorization is used or canceled`, `FiatTokenV2: invalid signature`.

### Rules

- An invoice is payable only while `status == Open`, exactly once, for exactly `amount`.
- **`payWithAuthorization` nonce rule (important for W2/W3):** the payer must sign `ReceiveWithAuthorization{from: payer, to: PaymentRouter, value: invoice.amount, validAfter, validBefore, nonce: paymentNonce(invoiceId)}`. Use `invoicePaymentNonce(router, invoiceId)` from `@paisalink/shared/src/abi` (or read `paymentNonce` on chain). Reason: EIP-3009 signatures do not name an invoice, so without this rule anyone could take a payer's signature from the mempool and use it to pay a different open invoice of the same amount. With it, a signature can only pay its own invoice. A payer whose authorization expired simply re-signs the same nonce with a new `validBefore` (the nonce is only consumed on success).
- Relayer pre-checks (off chain, before `eth_call` simulation): `to == PaymentRouter`, `value == getInvoice(id).amount`, `nonce == paymentNonce(id)`, `status == Open (1)`, `authorizationState(from, nonce) == false` on USDT.
- `refund` sends to the recorded payer; partial refunds allowed; total cannot exceed `balance`. When `refunded == amount`, status becomes `Refunded`.
- `withdraw` sends the whole `balance` to the merchant; status becomes `Withdrawn`; refunds are impossible afterwards. (The refund window is "until the merchant withdraws".)
- `*WithSig` functions can be sent by anyone, typically the relayer. The merchant's signature authorises the action; funds go only to the payer (refund) or the merchant (withdraw). Signatures are verified with OpenZeppelin `SignatureChecker`, so EOAs and ERC-1271 smart wallets both work. Each use consumes `nonces(merchant)`; a replayed signature fails with `InvalidSignature()`.
- **Financed invoices:** after `InvoiceNote.fund`, `financed == true`. When the invoice is then paid, the router emits `InvoicePaid` and **forwards the full amount to InvoiceNote** (`PaymentForwardedToNote`). `balance` stays 0, so the merchant cannot refund or withdraw it.

### EIP-712 typed data signed by the merchant (router)

Domain: `{ name: "PaisaLink PaymentRouter", version: "1", chainId: 1874, verifyingContract: PaymentRouter }` (`routerDomain(router)` in helpers).

```
Refund(bytes32 invoiceId,uint256 amount,uint256 nonce,uint256 deadline)
Withdraw(bytes32 invoiceId,uint256 nonce,uint256 deadline)
```

`nonce` = `PaymentRouter.nonces(merchant)` at signing time; `deadline` = unix seconds. Builders: `buildRefundTypedData(router, {...})`, `buildWithdrawTypedData(router, {...})`, then viem `signTypedData` and submit the 65-byte signature as `bytes`.

## InvoiceNote (Tokenize)

```solidity
constructor(address usdt, address router, address owner)

enum NoteState { None, Issued, Funded, Settled }                 // 0..3
struct Note {
  bytes32 invoiceId; address issuer; address holder;
  uint256 faceValue; uint256 price; uint256 escrow;
  uint64 maturity; NoteState state;
}

function setAllowed(address account, bool allowed) external;      // onlyOwner (compliance officer)
function allowed(address account) external view returns (bool);

function issue(bytes32 invoiceId, uint256 faceValue, uint256 price, uint64 maturity) external returns (uint256 noteId);
function issueWithSig(bytes32 invoiceId, uint256 faceValue, uint256 price, uint64 maturity,
                      uint256 deadline, bytes signature) external returns (uint256 noteId);
function fund(uint256 noteId) external;                            // allowlisted investor; USDT approve(note, price) first
function transfer(uint256 noteId, address to) external;            // holder -> allowlisted, before maturity
function repay(uint256 noteId) external;                           // tops escrow up to faceValue from msg.sender (approve first)
function settle(uint256 noteId) external;                          // on/after maturity; pays faceValue to holder
function onInvoicePaid(bytes32 invoiceId, uint256 amount) external; // router only

function getNote(uint256 noteId) external view returns (Note memory);
function noteOfInvoice(bytes32 invoiceId) external view returns (uint256);   // 0 = none
function nextNoteId() external view returns (uint256);                      // ids start at 1
function nonces(address merchant) external view returns (uint256);          // for Issue signatures
function usdt() / router() / owner() external view returns (address);
function DOMAIN_SEPARATOR() external view returns (bytes32);
function ISSUE_TYPEHASH() external view returns (bytes32);
```

Events:

```solidity
event NoteIssued(uint256 indexed noteId, bytes32 indexed invoiceId, address indexed issuer, uint256 faceValue, uint256 price, uint64 maturity);
event NoteFunded(uint256 indexed noteId, address indexed investor, uint256 price);
event NoteTransferred(uint256 indexed noteId, address indexed from, address indexed to);
event NoteEscrowFunded(uint256 indexed noteId, address indexed from, uint256 amount);
event NoteSettled(uint256 indexed noteId, address indexed holder, uint256 faceValue);
event AllowlistUpdated(address indexed account, bool allowed);
```

Custom errors: `ZeroAddress()`, `InvalidTerms()`, `NotIssuer(address)`, `InvoiceNotOpen(bytes32)`, `InvoiceAlreadyNoted(bytes32, uint256)`, `NoteNotFound(uint256)`, `WrongState(uint256 noteId, uint8 state)`, `NotAllowlisted(address)`, `NotHolder(address)`, `MaturityPassed(uint64 maturity)`, `NotMatured(uint64 maturity)`, `EscrowShort(uint256 escrow, uint256 faceValue)`, `NotRouter(address)`, `SignatureExpired(uint256)`, `InvalidSignature()`.

### Rules enforced in Solidity

1. **Issue:** only the invoice's merchant (directly, or by `Issue` signature through the relayer); the invoice must be `Open` and not yet financed; one note per invoice; `0 < price <= faceValue <= invoice.amount`; `maturity > now`. Short maturities (for example `now + 120`) are allowed for the demo.
2. **Fund:** only an allowlisted investor (`NotAllowlisted`), only while `Issued` and before maturity. Pulls `price` USDT from the investor **directly to the issuer** (the merchant gets cash today) and makes the investor the holder. It calls `PaymentRouter.markFinanced`, which reverts if the invoice is no longer `Open`.
3. **Transfer:** only the holder, only while `Funded`, only **before maturity** (`MaturityPassed`), and both sender and receiver must be allowlisted (`NotAllowlisted`).
4. **Settle:** only while `Funded`, only **on or after maturity** (`NotMatured`), only when `escrow >= faceValue` (`EscrowShort`). Pays exactly `faceValue` USDT to the current holder; any escrow above `faceValue` goes back to the issuer. USDT is the only settlement path. Anyone may call it (it can only pay the holder).

### How settlement is funded (enforced on chain)

Escrow, not a promise: the face value sits in the InvoiceNote contract before `settle` can run.

- **Primary path (automatic):** once a note is funded, the router has `financed = true` for that invoice. When the customer pays the invoice (`pay` or `payWithAuthorization`), the router transfers the whole payment to InvoiceNote and calls `onInvoicePaid`, which adds it to `escrow`. The merchant cannot divert it, because the router never credits `balance` for a financed invoice.
- **Recourse path:** if the invoice is unpaid at maturity, the issuer (or anyone) calls `repay(noteId)` after approving USDT; it deposits `faceValue - escrow`. If the customer pays later, after the note was settled through `repay`, the late payment goes straight to the issuer.
- Until one of these happens, `settle` reverts with `EscrowShort`, and the note simply stays `Funded`. That is the honest state of an unpaid invoice.

### EIP-712 typed data signed by the merchant (note)

Domain: `{ name: "PaisaLink InvoiceNote", version: "1", chainId: 1874, verifyingContract: InvoiceNote }` (`noteDomain(note)`).

```
Issue(bytes32 invoiceId,uint256 faceValue,uint256 price,uint64 maturity,uint256 nonce,uint256 deadline)
```

`nonce` = `InvoiceNote.nonces(merchant)` (separate from the router's counter). Builder: `buildIssueTypedData(note, {...})`.

## Demo lifecycle (W5)

1. Merchant invoice `I` (amount 100 USDT) is `Open` (created through the API, `createInvoiceFor`).
2. `issue(I, 100e6, 97e6, now+120)` (or `issueWithSig` via the relayer): note 1 `Issued`.
3. Investor (allowlisted at deploy) `USDT.approve(note, 97e6)`, `fund(1)`: merchant receives 97 USDT now; the invoice is financed.
4. Payer pays invoice `I` (gasless): 100 USDT is forwarded to note escrow (`PaymentForwardedToNote`, `NoteEscrowFunded`).
5. After 120 s: `transfer(1, x)` reverts `MaturityPassed`; `settle(1)` pays 100 USDT to the investor (`NoteSettled`).

## Deployment

`contracts/script/Deploy.s.sol`: deploys PaymentRouter(usdt, owner=deployer, operator=relayer), InvoiceNote(usdt, router, owner=deployer), calls `router.setNoteContract(note)`, allowlists the demo investor and the demo payer (so a transfer before maturity can be shown). It then writes `contracts/deployments/1874.json`. Both contracts are verified on Blockscout (`https://explorer.testnet.whitechain.io`).

### Commands (from `contracts/`)

```bash
export PATH=$HOME/.foundry/bin:$PATH
forge build && forge test                                   # 65 unit tests (mock EIP-3009 token in test/mocks, test-only)
RUN_FORK=1 forge test --match-contract ForkUSDT             # 4 tests on a fork of 1874 against the REAL USDT
set -a && . ../.env.local && set +a                         # loads keys; never echo them
forge script script/Deploy.s.sol --rpc-url whitechain_testnet --broadcast   # needs ~0.03 WBT on the deployer
bun script/write-deployment.ts                              # writes deployments/1874.json from broadcast/
bash script/verify.sh                                       # Blockscout verification of both contracts
forge script script/FirstPayment.s.sol --rpc-url whitechain_testnet --broadcast   # relayer WBT + payer (or deployer) USDT
cd .. && bun run gen:abi                                    # regenerate packages/shared/src/abi after any change
```

### Deployed (Whitechain testnet 1874, block 12343606, verified on Blockscout)

- PaymentRouter `0x97613d5bE2c3dd747c110b460Ff2e0FC69701005`: https://explorer.testnet.whitechain.io/address/0x97613d5bE2c3dd747c110b460Ff2e0FC69701005
- InvoiceNote `0x9e9Fa5E8857a309C51d18822182e9BDcd0117Ac7`: https://explorer.testnet.whitechain.io/address/0x9e9Fa5E8857a309C51d18822182e9BDcd0117Ac7
- Tx hashes: `contracts/deployments/1874.json`. Import with `requireAddresses()` from `packages/shared/src/addresses.ts`.
