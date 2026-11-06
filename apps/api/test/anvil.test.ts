// Integration test against the REAL compiled PaymentRouter on a local anvil chain (id 1874), through the production
// viem layer (viem-chain.ts) and the HTTP app. USDT is W1's TEST-ONLY MockEIP3009 placed at the real USDT address with
// anvil_setCode so the pinned "Tether USD" EIP-712 domain verifies unchanged. Store: test-only MemoryStore.
// Skips when anvil or contracts/out is missing. All keys are generated per run and funded with anvil_setBalance.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createPublicClient, createWalletClient, http, parseUnits, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { USDT_ADDRESS, buildReceiveAuthTypedData, invoicePaymentNonce, paymentRouterAbi, whitechainTestnet } from "@paisalink/shared";
import { loadConfig } from "../src/config";
import { createApp } from "../src/app";
import { createViemFaucetChain, createViemRouterChain } from "../src/viem-chain";
import { MemoryStore } from "./memory-store";

const ROOT = join(import.meta.dir, "../../..");
const ANVIL = join(homedir(), ".foundry/bin/anvil");
const art = (n: string) => join(ROOT, `contracts/out/${n}.sol/${n}.json`);
const available = existsSync(ANVIL) && existsSync(art("PaymentRouter")) && existsSync(art("MockEIP3009"));
const PORT = 18545 + Math.floor(Math.random() * 1000);
const RPC = `http://127.0.0.1:${PORT}`;

describe.skipIf(!available)("anvil: real PaymentRouter through the production viem layer", () => {
  let proc: ReturnType<typeof Bun.spawn> | undefined;
  let router: `0x${string}`;
  const OWNER_KEY = generatePrivateKey();
  const owner = privateKeyToAccount(OWNER_KEY);
  const relayerKey = generatePrivateKey();
  const relayer = privateKeyToAccount(relayerKey);
  const merchant = privateKeyToAccount(generatePrivateKey());
  const payer = privateKeyToAccount(generatePrivateKey());
  const chain = { ...whitechainTestnet, rpcUrls: { default: { http: [RPC] } } };
  const pub = createPublicClient({ chain, transport: http(RPC) });
  const ownerWallet = createWalletClient({ account: owner, chain, transport: http(RPC) });
  let ctx: Awaited<ReturnType<typeof createApp>>;
  let store: MemoryStore;
  const post = (p: string, b: unknown) => ctx.app.request(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

  beforeAll(async () => {
    proc = Bun.spawn([ANVIL, "--chain-id", "1874", "--port", String(PORT), "--silent"], { stdout: "ignore", stderr: "ignore" });
    for (let i = 0; i < 50; i++) { try { await pub.getChainId(); break; } catch { await Bun.sleep(100); } }
    for (const a of [owner.address]) await pub.request({ method: "anvil_setBalance" as any, params: [a, "0x56BC75E2D63100000"] as any });
    const load = (n: string) => JSON.parse(readFileSync(art(n), "utf8")) as { abi: unknown[]; bytecode: { object: Hex } };
    // USDT mock at the real USDT address
    const mock = load("MockEIP3009");
    const h1 = await ownerWallet.deployContract({ abi: mock.abi, bytecode: mock.bytecode.object, args: [] });
    const mockAddr = (await pub.waitForTransactionReceipt({ hash: h1 })).contractAddress!;
    const code = await pub.getCode({ address: mockAddr });
    await pub.request({ method: "anvil_setCode" as any, params: [USDT_ADDRESS, code] as any });
    await pub.request({ method: "anvil_setBalance" as any, params: [relayer.address, "0x56BC75E2D63100000"] as any }); // 100 ETH
    const mint = await ownerWallet.writeContract({ address: USDT_ADDRESS, abi: mock.abi, functionName: "mint", args: [payer.address, parseUnits("100", 6)] });
    await pub.waitForTransactionReceipt({ hash: mint });
    // PaymentRouter(usdt, owner, operator = relayer)
    const pr = load("PaymentRouter");
    const h2 = await ownerWallet.deployContract({ abi: pr.abi, bytecode: pr.bytecode.object, args: [USDT_ADDRESS, owner.address, relayer.address] });
    router = (await pub.waitForTransactionReceipt({ hash: h2 })).contractAddress!;

    store = new MemoryStore();
    await store.upsertMerchant({ wallet: merchant.address, handle: "anvil-shop", verified: true, gasUsedWei: "0", createdAt: 1 });
    const m2 = await ownerWallet.writeContract({ address: USDT_ADDRESS, abi: mock.abi, functionName: "mint", args: [owner.address, parseUnits("1000", 6)] });
    await pub.waitForTransactionReceipt({ hash: m2 });
    const config = loadConfig({ WC_CHAIN_ID: "1874", WC_RPC_URL: RPC, PAYMENT_ROUTER_ADDRESS: router, RELAYER_PRIVATE_KEY: relayerKey, DEPLOYER_PRIVATE_KEY: OWNER_KEY });
    ctx = await createApp({ config, store, chain: createViemRouterChain(config), faucet: createViemFaucetChain(config), pluginDir: false });
  }, 30_000);

  afterAll(() => { proc?.kill(); });

  test("create -> gasless relay -> partial refund -> full refund, store derived from events", async () => {
    const now = () => Math.floor(Date.now() / 1000);
    const cr = await post("/invoices", { merchant: merchant.address, amountUsdt: "49", dueAt: now() + 86400, memo: "anvil e2e" });
    expect(cr.status).toBe(201);
    const inv = (await cr.json()) as { invoiceId: Hex; createTx: Hex };
    const onchain = (await pub.readContract({ address: router, abi: paymentRouterAbi, functionName: "getInvoice", args: [inv.invoiceId] })) as any;
    expect(onchain.merchant).toBe(merchant.address);
    expect(onchain.amount).toBe(49_000_000n);

    const authorization = { from: payer.address, to: router, value: "49000000", validAfter: 0, validBefore: now() + 300, nonce: invoicePaymentNonce(router, inv.invoiceId) };
    // a random nonce is rejected before simulation (would revert WrongNonce on chain)
    const badAuth = { ...authorization, nonce: generatePrivateKey() };
    const bad = await post("/relay", { invoiceId: inv.invoiceId, authorization: badAuth, signature: await payer.signTypedData(buildReceiveAuthTypedData(badAuth)) });
    expect(((await bad.json()) as any).code).toBe("BAD_AUTHORIZATION");

    const r = await post("/relay", { invoiceId: inv.invoiceId, authorization, signature: await payer.signTypedData(buildReceiveAuthTypedData(authorization)) });
    const j = (await r.json()) as any;
    expect(r.status).toBe(200);
    const receipt = await pub.getTransactionReceipt({ hash: j.txHash });
    expect(receipt.status).toBe("success");
    expect(receipt.from.toLowerCase()).toBe(relayer.address.toLowerCase()); // relayer paid the gas, not the payer
    expect((await store.getInvoice(inv.invoiceId))!.state).toBe("paid");
    expect((await store.getPayment(inv.invoiceId))!.payer).toBe(payer.address);
    expect(BigInt((await store.getMerchant(merchant.address))!.gasUsedWei)).toBeGreaterThan(0n);

    // partial refund via the browser flow (typed data from the API, signed by the merchant)
    const sign = async (amountUsdt?: string) => {
      const td = (await (await ctx.app.request(`/invoices/${inv.invoiceId}/refund-typed-data${amountUsdt ? `?amountUsdt=${amountUsdt}` : ""}`)).json()) as any;
      const m = td.typedData.message;
      const signature = await merchant.signTypedData({ ...td.typedData, message: { invoiceId: m.invoiceId, amount: BigInt(m.amount), nonce: BigInt(m.nonce), deadline: BigInt(m.deadline) } });
      return { amountUsdt, deadline: td.deadline, signature };
    };
    const s1 = await sign("9");
    const r1 = await post(`/invoices/${inv.invoiceId}/refund`, s1);
    const j1 = (await r1.json()) as any;
    expect(r1.status).toBe(200);
    expect(j1.state).toBe("paid");
    // replaying the same merchant signature fails (router nonce consumed)
    expect(((await (await post(`/invoices/${inv.invoiceId}/refund`, s1)).json()) as any).code).toBe("BAD_SIGNATURE");
    const r2 = await post(`/invoices/${inv.invoiceId}/refund`, await sign());
    const j2 = (await r2.json()) as any;
    expect(j2.state).toBe("refunded");
    expect(j2.refundedUsdt).toBe("40");
    expect((await store.getInvoice(inv.invoiceId))!.state).toBe("refunded");
    const after = (await pub.readContract({ address: router, abi: paymentRouterAbi, functionName: "getInvoice", args: [inv.invoiceId] })) as any;
    expect(after.refunded).toBe(49_000_000n);
  }, 60_000);

  test("unverified merchant cannot use the relayer", async () => {
    const m2 = privateKeyToAccount(generatePrivateKey());
    await store.upsertMerchant({ wallet: m2.address, handle: "unverified", verified: false, gasUsedWei: "0", createdAt: 1 });
    const now = Math.floor(Date.now() / 1000);
    const inv = (await (await post("/invoices", { merchant: m2.address, amountUsdt: "5", dueAt: now + 3600 })).json()) as { invoiceId: Hex };
    const authorization = { from: payer.address, to: router, value: "5000000", validAfter: 0, validBefore: now + 300, nonce: invoicePaymentNonce(router, inv.invoiceId) };
    const r = await post("/relay", { invoiceId: inv.invoiceId, authorization, signature: await payer.signTypedData(buildReceiveAuthTypedData(authorization)) });
    expect(r.status).toBe(403);
    expect(((await r.json()) as any).code).toBe("MERCHANT_NOT_VERIFIED");
  }, 30_000);

  test("demo faucet sends real (anvil) test USDT and refuses a second grant", async () => {
    const fresh = privateKeyToAccount(generatePrivateKey()).address;
    const r = await post("/demo/fund", { address: fresh });
    const j = (await r.json()) as any;
    expect(r.status).toBe(200);
    expect(j.demo).toBe(true);
    expect((await pub.getTransactionReceipt({ hash: j.txHash })).status).toBe("success");
    const erc20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }] as const;
    expect(await pub.readContract({ address: USDT_ADDRESS, abi: erc20, functionName: "balanceOf", args: [fresh] })).toBe(60_000_000n);
    expect(((await (await post("/demo/fund", { address: fresh })).json()) as any).code).toBe("DEMO_FAUCET_LIMIT");
  }, 30_000);

  test("/health reads the anvil chain", async () => {
    const j = (await (await ctx.app.request("/health")).json()) as any;
    expect(j.ok).toBe(true);
    expect(j.relayer.address).toBe(relayer.address);
  });
});
