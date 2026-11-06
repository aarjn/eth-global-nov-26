import { expect, test } from "bun:test";
import { http, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { whitechainTestnet } from "@paisalink/shared";
import { sharedSender, senderStats } from "../src/senders";

// Fake public client whose "pending" count lags (as real RPCs do): the shared sender must still hand out 0,1,2,...
const lagging = { getTransactionCount: async () => 0 } as unknown as PublicClient;

test("same key -> same queue, even when two modules ask for it", () => {
  const acct = privateKeyToAccount(generatePrivateKey());
  const a = sharedSender(acct, lagging, whitechainTestnet, http("http://x"), "http://x");
  const b = sharedSender(privateKeyToAccount(generatePrivateKey()), lagging, whitechainTestnet, http("http://x"), "http://x");
  const c = sharedSender(acct, lagging, whitechainTestnet, http("http://y"), "http://y");
  expect(sharedSender(acct, lagging, whitechainTestnet, http("http://x"), "http://x")).toBe(a);
  expect(b).not.toBe(a); // different key
  expect(c).not.toBe(a); // different RPC
});

test("concurrent sends from relayer + faucet + notes on one key get distinct sequential nonces", async () => {
  const acct = privateKeyToAccount(generatePrivateKey());
  const s1 = sharedSender(acct, lagging, whitechainTestnet, http("http://z"), "http://z");
  const s2 = sharedSender(acct, lagging, whitechainTestnet, http("http://z"), "http://z");
  const used: number[] = [];
  const build = (n: number) => async () => { used.push(n); await Bun.sleep(2); return `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`; };
  const jobs = [s1.send((n) => build(n)()), s2.run((n) => build(n)()), s1.send((n) => build(n)()), s2.send((n) => build(n)())];
  await Promise.all(jobs);
  expect(used).toEqual([0, 1, 2, 3]);
  expect(senderStats().find((x) => x.address === acct.address)?.sent).toBe(4);
});

test("nonce error resyncs from chain and retries", async () => {
  let count = 5;
  const pub = { getTransactionCount: async () => count } as unknown as PublicClient;
  const acct = privateKeyToAccount(generatePrivateKey());
  const s = sharedSender(acct, pub, whitechainTestnet, http("http://n"), "http://n");
  const tried: number[] = [];
  const h = await s.send(async (n) => {
    tried.push(n);
    if (tried.length === 1) { count = 7; throw new Error("nonce too low"); }
    return `0x${"1".repeat(64)}`;
  });
  expect(h).toMatch(/^0x1/);
  expect(tried).toEqual([5, 7]);
});
