// W5 integration test: the full InvoiceNote lifecycle against the REAL compiled PaymentRouter + InvoiceNote on a local
// anvil chain (id 1874), through the production viem layer (createViemNoteChain) and the HTTP routes.
// issue (merchant signature, relayer gas) -> rule reverts -> fund (allowlisted investor) -> customer pays gaslessly
// (router forwards to the note escrow) -> transfer -> maturity -> transfer reverts MaturityPassed -> settle.
// USDT is W1's TEST-ONLY MockEIP3009 placed at the real USDT address with anvil_setCode (as in anvil.test.ts).
// Store: TEST-ONLY MemoryStore. Keys are generated per run. Skips when anvil or contracts/out is missing.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createPublicClient, createWalletClient, erc20Abi, http, parseUnits, type Abi, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { USDT_ADDRESS, buildReceiveAuthTypedData, invoiceNoteAbi, invoicePaymentNonce, whitechainTestnet, type Address } from "@paisalink/shared";
import { loadConfig } from "../src/config";
import { createApp } from "../src/app";
import { createViemFaucetChain, createViemRouterChain, revertReason } from "../src/viem-chain";
import { notesRoutes } from "../src/routes/notes";
import { MemoryStore } from "./memory-store";

const ROOT = join(import.meta.dir, "../../..");
const ANVIL = join(homedir(), ".foundry/bin/anvil");
const art = (n: string) => join(ROOT, `contracts/out/${n}.sol/${n}.json`);
const available = existsSync(ANVIL) && ["PaymentRouter", "InvoiceNote", "MockEIP3009"].every((n) => existsSync(art(n)));
const PORT = 19545 + Math.floor(Math.random() * 1000);
const RPC = `http://127.0.0.1:${PORT}`;
const ETH100 = "0x56BC75E2D63100000";

describe.skipIf(!available)("anvil: InvoiceNote lifecycle through /notes routes", () => {
  let proc: ReturnType<typeof Bun.spawn> | undefined;
  let router: Address, note: Address;
  const OWNER_KEY = generatePrivateKey();
  const owner = privateKeyToAccount(OWNER_KEY);
  const relayerKey = generatePrivateKey();
  const relayer = privateKeyToAccount(relayerKey);
  const merchant = privateKeyToAccount(generatePrivateKey());
  const payer = privateKeyToAccount(generatePrivateKey());
  const investor = privateKeyToAccount(generatePrivateKey());
  const investor2 = privateKeyToAccount(generatePrivateKey());
  const chain = { ...whitechainTestnet, rpcUrls: { default: { http: [RPC] } } };
  const pub = createPublicClient({ chain, transport: http(RPC) });
  const wallet = (a: PrivateKeyAccount) => createWalletClient({ account: a, chain, transport: http(RPC) });
  let ctx: Awaited<ReturnType<typeof createApp>>;
  let store: MemoryStore;
  const req = async (p: string, b?: unknown) => {
    const r = await ctx.app.request(p, b === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    return { status: r.status, body: (await r.json()) as any };
  };
  const balance = (a: Address) => pub.readContract({ address: USDT_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [a] });
  const send = async (a: PrivateKeyAccount, address: Address, abi: Abi, functionName: string, args: unknown[], gas?: bigint) => {
    const hash = await wallet(a).writeContract({ address, abi, functionName, args, ...(gas ? { gas } : {}) } as never);
    return pub.waitForTransactionReceipt({ hash });
  };
  /** eth_call from `from` (no key needed): returns the decoded revert reason, or "ok". */
  const tryCall = async (from: Address, functionName: string, args: unknown[]) => {
    try { await pub.simulateContract({ address: note, abi: invoiceNoteAbi as Abi, functionName, args, account: from }); return "ok"; }
    catch (e) { return revertReason(e); }
  };

  beforeAll(async () => {
    proc = Bun.spawn([ANVIL, "--chain-id", "1874", "--port", String(PORT), "--silent"], { stdout: "ignore", stderr: "ignore" });
    for (let i = 0; i < 50; i++) { try { await pub.getChainId(); break; } catch { await Bun.sleep(100); } }
    for (const a of [owner.address, relayer.address, payer.address]) await pub.request({ method: "anvil_setBalance" as any, params: [a, ETH100] as any });
    const load = (n: string) => JSON.parse(readFileSync(art(n), "utf8")) as { abi: Abi; bytecode: { object: Hex } };
    const deploy = async (n: string, args: unknown[]) => {
      const a = load(n);
      const h = await wallet(owner).deployContract({ abi: a.abi, bytecode: a.bytecode.object, args } as never);
      return { addr: (await pub.waitForTransactionReceipt({ hash: h })).contractAddress!, abi: a.abi };
    };
    const mock = await deploy("MockEIP3009", []);
    await pub.request({ method: "anvil_setCode" as any, params: [USDT_ADDRESS, await pub.getCode({ address: mock.addr })] as any });
    const pr = await deploy("PaymentRouter", [USDT_ADDRESS, owner.address, relayer.address]);
    router = pr.addr;
    const nt = await deploy("InvoiceNote", [USDT_ADDRESS, router, owner.address]);
    note = nt.addr;
    await send(owner, router, pr.abi, "setNoteContract", [note]);
    for (const [to, amt] of [[payer.address, "100"], [investor.address, "200"]] as const) await send(owner, USDT_ADDRESS, mock.abi, "mint", [to, parseUnits(amt, 6)]);

    store = new MemoryStore();
    await store.upsertMerchant({ wallet: merchant.address, handle: "export-house", verified: true, gasUsedWei: "0", createdAt: 1 });
    const config = loadConfig({
      WC_CHAIN_ID: "1874", WC_RPC_URL: RPC, PAYMENT_ROUTER_ADDRESS: router, INVOICE_NOTE_ADDRESS: note,
      RELAYER_PRIVATE_KEY: relayerKey, DEPLOYER_PRIVATE_KEY: OWNER_KEY,
    });
    ctx = await createApp({ config, store, chain: createViemRouterChain(config), faucet: createViemFaucetChain(config), pluginDir: false });
    ctx.app.route("/", notesRoutes({ store, config, relayer: ctx.relayer, notify: (m, k, id) => ctx.relayer.notify(m, k, id) }));
  }, 60_000);

  afterAll(() => { proc?.kill(); });

  test("issue -> fund -> pay -> transfer -> mature -> settle, with every rule reverting on chain", async () => {
    // 1. merchant invoice (100 USDT), created by the relayer
    const now = Math.floor(Date.now() / 1000);
    const cr = await req("/invoices", { merchant: merchant.address, amountUsdt: "100", dueAt: now + 86400, memo: "export order" });
    expect(cr.status).toBe(201);
    const invoiceId = cr.body.invoiceId as Hex;

    // 2. sell it: Issue typed data signed by the merchant, relayer submits issueWithSig (merchant has no gas at all)
    expect(await pub.getBalance({ address: merchant.address })).toBe(0n);
    const td = await req(`/invoices/${invoiceId}/note-typed-data?maturitySec=60`);
    expect(td.status).toBe(200);
    expect(td.body).toMatchObject({ faceUsdt: "100", priceUsdt: "97.5", discountPct: 2.5 });
    const m = td.body.typedData.message;
    const signature = await merchant.signTypedData({
      ...td.body.typedData, domain: { ...td.body.typedData.domain, chainId: Number(td.body.typedData.domain.chainId) },
      message: { invoiceId: m.invoiceId, faceValue: BigInt(m.faceValue), price: BigInt(m.price), maturity: BigInt(m.maturity), nonce: BigInt(m.nonce), deadline: BigInt(m.deadline) },
    });
    const issued = await req("/notes/issue", { invoiceId, faceUsdt: "100", priceUsdt: "97.5", maturity: m.maturity, deadline: m.deadline, signature });
    expect(issued.status).toBe(201);
    expect(issued.body.note).toMatchObject({ noteId: 1, state: "issued", faceUsdt: "100", priceUsdt: "97.5", issuer: merchant.address });
    const issueTx = await pub.getTransactionReceipt({ hash: issued.body.txHash });
    expect(issueTx.from.toLowerCase()).toBe(relayer.address.toLowerCase());
    // replaying the same signature fails: one note per invoice, and the merchant's Issue nonce is consumed
    expect((await req("/notes/issue", { invoiceId, faceUsdt: "100", priceUsdt: "97.5", maturity: m.maturity, deadline: m.deadline, signature })).body.code).toBe("INVOICE_ALREADY_NOTED");

    // 3. rule: a non-allowlisted wallet cannot fund
    expect(await tryCall(privateKeyToAccount(generatePrivateKey()).address, "fund", [1n])).toMatch(/^NotAllowlisted/);

    // 4. demo compliance desk allowlists the investor and sends gas; investor funds with its own wallet
    const desk = await req("/notes/demo-investor", { address: investor.address });
    expect(desk.status).toBe(200);
    expect(desk.body).toMatchObject({ demo: true, allowed: true });
    expect(await pub.getBalance({ address: investor.address })).toBeGreaterThan(0n);
    expect((await req("/notes/demo-investor", { address: investor2.address })).body.allowed).toBe(true);
    const merchantBefore = await balance(merchant.address);
    expect((await send(investor, USDT_ADDRESS, erc20Abi, "approve", [note, parseUnits("97.5", 6)])).status).toBe("success");
    expect((await send(investor, note, invoiceNoteAbi as Abi, "fund", [1n])).status).toBe("success");
    expect((await balance(merchant.address)) - merchantBefore).toBe(97_500_000n); // cash today
    let s = await req("/notes/1/sync", {});
    expect(s.body.note).toMatchObject({ state: "funded", investor: investor.address });
    expect((await store.getInvoice(invoiceId))!.state).toBe("financed");

    // 5. the customer pays the financed invoice gaslessly: the router forwards the 100 USDT into the note escrow
    const authorization = { from: payer.address, to: router, value: "100000000", validAfter: 0, validBefore: Math.floor(Date.now() / 1000) + 300, nonce: invoicePaymentNonce(router, invoiceId) };
    const paid = await req("/relay", { invoiceId, authorization, signature: await payer.signTypedData(buildReceiveAuthTypedData(authorization)) });
    expect(paid.status).toBe(200);
    s = await req("/notes/1/sync", {});
    expect(s.body.onchain).toMatchObject({ escrowUsdt: "100", escrowFull: true });
    expect(s.body.invoice.state).toBe("paid");

    // 6. rules before maturity: settle reverts NotMatured; transfer to a non-allowlisted wallet reverts; a transfer
    //    to an allowlisted wallet works
    expect(await tryCall(investor.address, "settle", [1n])).toMatch(/^NotMatured/);
    expect(await tryCall(investor.address, "transfer", [1n, payer.address])).toMatch(/^NotAllowlisted/);
    expect((await send(investor, note, invoiceNoteAbi as Abi, "transfer", [1n, investor2.address])).status).toBe("success");
    s = await req("/notes/1/sync", {});
    expect(s.body.note.investor).toBe(investor2.address);

    // 7. maturity passes: transfers are locked (eth_call shows the reason; a forced tx reverts on chain too)
    await pub.request({ method: "evm_increaseTime" as any, params: [120] as any });
    await pub.request({ method: "evm_mine" as any, params: [] as any });
    expect(await tryCall(investor2.address, "transfer", [1n, investor.address])).toMatch(/^MaturityPassed/);
    await pub.request({ method: "anvil_setBalance" as any, params: [investor2.address, ETH100] as any });
    expect((await send(investor2, note, invoiceNoteAbi as Abi, "transfer", [1n, investor.address], 200_000n)).status).toBe("reverted");

    // 8. settle (anyone may call; it pays the holder exactly the face value from escrow)
    const holderBefore = await balance(investor2.address);
    expect((await send(investor, note, invoiceNoteAbi as Abi, "settle", [1n])).status).toBe("success");
    expect((await balance(investor2.address)) - holderBefore).toBe(100_000_000n);
    s = await req("/notes/1/sync", {});
    expect(s.body.note.state).toBe("settled");
    expect((await store.getInvoice(invoiceId))!.state).toBe("settled");

    // 9. the lifecycle is readable from chain events, with tx links
    const one = await req("/notes/1");
    expect(one.body.inSync).toBe(true);
    expect(one.body.events.map((e: { name: string }) => e.name)).toEqual(["NoteIssued", "NoteFunded", "NoteEscrowFunded", "NoteTransferred", "NoteSettled"]);
    const list = await req("/notes");
    expect(list.body.notes[0]).toMatchObject({ noteId: 1, state: "settled", onchain: { state: "settled", matured: true } });
  }, 90_000);
});
