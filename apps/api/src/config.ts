import { getAddress, isAddress, parseEther } from "viem";
import { USDT_ADDRESS, WHITECHAIN_TESTNET_ID, type Address, type Hex } from "@paisalink/shared";
import { DEPLOYMENT } from "@paisalink/shared";

/** Runtime configuration. Secrets stay inside this object and are never logged (see redactedConfig). */
export interface ApiConfig {
  port: number;
  rpcUrl: string;
  chainId: number;
  explorerUrl: string;
  arkivChainId: number;
  usdt: Address;
  paymentRouter?: Address;
  invoiceNote?: Address;
  relayerKey?: Hex;
  deployerKey?: Hex;
  corsOrigins: string[] | "*";
  trustProxy: boolean;
  limits: {
    /** Per-merchant sponsored gas per UTC day, in wei (0.02 WBT). */
    merchantDailyGasWei: bigint;
    payerPerHour: number;
    ipPerHour: number;
    globalPerHour: number;
    /** Invoice creation is also sponsored; separate, looser limits. */
    invoiceIpPerHour: number;
    invoiceMerchantPerHour: number;
    /** Max seconds between now and validBefore (10 minutes). */
    maxAuthWindowSec: number;
    /** Min seconds left before validBefore so the tx can still be mined. */
    minAuthRemainingSec: number;
  };
  demo: { enabled: boolean; amountUsdt: string; ipPerHour: number };
}

function addr(v: string | undefined): Address | undefined {
  if (!v) return undefined;
  if (!isAddress(v)) throw new Error(`invalid address in env: ${v}`);
  return getAddress(v);
}
function key(v: string | undefined): Hex | undefined {
  if (!v) return undefined;
  const k = (v.startsWith("0x") ? v : `0x${v}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error("a private key in env is malformed (value not shown)");
  return k;
}
const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export function loadConfig(env: Record<string, string | undefined> = process.env): ApiConfig {
  const chainId = num(env.WC_CHAIN_ID, WHITECHAIN_TESTNET_ID);
  const cors = (env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    port: num(env.API_PORT, 8787),
    rpcUrl: env.WC_RPC_URL || "https://rpc.testnet.whitechain.io",
    chainId,
    explorerUrl: (env.WC_EXPLORER_URL || "https://explorer.testnet.whitechain.io").replace(/\/$/, ""),
    arkivChainId: num(env.ARKIV_CHAIN_ID, 7794095),
    usdt: addr(env.USDT_ADDRESS) ?? USDT_ADDRESS,
    // env wins; otherwise contracts/deployments/1874.json (via @paisalink/shared addresses.ts)
    paymentRouter: addr(env.PAYMENT_ROUTER_ADDRESS) ?? addr(DEPLOYMENT.deployed ? DEPLOYMENT.paymentRouter ?? undefined : undefined),
    invoiceNote: addr(env.INVOICE_NOTE_ADDRESS) ?? addr(DEPLOYMENT.deployed ? DEPLOYMENT.invoiceNote ?? undefined : undefined),
    relayerKey: key(env.RELAYER_PRIVATE_KEY),
    deployerKey: key(env.DEPLOYER_PRIVATE_KEY),
    corsOrigins: cors.length ? cors : "*",
    trustProxy: env.TRUST_PROXY === "1",
    limits: {
      merchantDailyGasWei: parseEther(env.MERCHANT_DAILY_GAS_WBT || "0.02"),
      payerPerHour: num(env.RL_PAYER_PER_HOUR, 10),
      ipPerHour: num(env.RL_IP_PER_HOUR, 60),
      globalPerHour: num(env.RL_GLOBAL_PER_HOUR, 300),
      invoiceIpPerHour: num(env.RL_INVOICE_IP_PER_HOUR, 60),
      invoiceMerchantPerHour: num(env.RL_INVOICE_MERCHANT_PER_HOUR, 60),
      maxAuthWindowSec: 600,
      minAuthRemainingSec: 20,
    },
    // The demo faucet only ever runs on Whitechain testnet (chain id 1874).
    demo: { enabled: chainId === WHITECHAIN_TESTNET_ID && env.DEMO_FAUCET !== "0", amountUsdt: env.DEMO_FUND_USDT || "60", ipPerHour: 5 },
  };
}

/** Safe to print: no keys. */
export function redactedConfig(c: ApiConfig) {
  const { relayerKey, deployerKey, ...rest } = c;
  return { ...rest, relayerKey: relayerKey ? "set" : "missing", deployerKey: deployerKey ? "set" : "missing", limits: { ...c.limits, merchantDailyGasWei: c.limits.merchantDailyGasWei.toString() } };
}
