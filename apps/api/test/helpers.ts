import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { parseUnits } from "viem";
import { buildReceiveAuthTypedData, type Address, type Eip3009Authorization, type Hex } from "@paisalink/shared";
import { invoicePaymentNonce, buildRefundTypedData } from "@paisalink/shared";
import { loadConfig } from "../src/config";
import { createApp } from "../src/app";
import { MemoryStore } from "./memory-store";
import { FakeChain, FakeFaucet, ROUTER } from "./fake-chain";

export const NOW_MS = 1_800_000_000_000;

export function testConfig(over: Record<string, string> = {}) {
  return loadConfig({ WC_CHAIN_ID: "1874", PAYMENT_ROUTER_ADDRESS: ROUTER, ...over });
}

export async function setup(opts: { verified?: boolean; env?: Record<string, string> } = {}) {
  let now = NOW_MS;
  const clock = () => now;
  const store = new MemoryStore();
  const chain = new FakeChain();
  const faucet = new FakeFaucet();
  const merchantAcct = privateKeyToAccount(generatePrivateKey());
  const payerAcct = privateKeyToAccount(generatePrivateKey());
  await store.upsertMerchant({ wallet: merchantAcct.address, handle: "chai-studio", verified: opts.verified ?? true, gasUsedWei: "0", createdAt: 1 });
  const { app, relayer, faucet: demo } = await createApp({ config: testConfig(opts.env), store, chain, faucet, pluginDir: false, now: clock });
  relayer.syncRetryMs = 0;
  const advance = (ms: number) => { now += ms; };
  const nowSec = () => Math.floor(now / 1000);

  const post = (path: string, body: unknown, ip = "1.2.3.4") =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });

  async function createInvoice(amountUsdt = "49", merchant: Address = merchantAcct.address) {
    const r = await relayer.createInvoice({ merchant, amountUsdt, dueAt: nowSec() + 86400, memo: "Logo design" }, "9.9.9.9");
    return r;
  }

  async function signAuth(invoiceId: Hex, amountUsdt = "49", over: Partial<Eip3009Authorization> = {}, signer = payerAcct) {
    const authorization: Eip3009Authorization = {
      from: signer.address, to: ROUTER, value: parseUnits(amountUsdt, 6).toString(), validAfter: 0,
      validBefore: nowSec() + 300, nonce: invoicePaymentNonce(ROUTER, invoiceId), ...over,
    };
    const signature = await signer.signTypedData(buildReceiveAuthTypedData(authorization));
    return { invoiceId, authorization, signature };
  }

  async function signRefund(invoiceId: Hex, amount: bigint, deadline: bigint, signer = merchantAcct) {
    const nonce = await chain.merchantNonce(merchantAcct.address);
    return signer.signTypedData(buildRefundTypedData(ROUTER, { invoiceId, amount, nonce, deadline }));
  }

  return { app, relayer, demo, store, chain, faucet, merchantAcct, payerAcct, advance, nowSec, post, createInvoice, signAuth, signRefund };
}
