import { defineChain } from "viem";
export const WHITECHAIN_TESTNET_ID = 1874 as const;
export const whitechainTestnet = defineChain({
  id: WHITECHAIN_TESTNET_ID,
  name: "Whitechain Testnet",
  nativeCurrency: { name: "WBT", symbol: "WBT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.whitechain.io"], webSocket: ["wss://rpc.testnet.whitechain.io/ws"] } },
  blockExplorers: { default: { name: "Whitechain Explorer", url: "https://explorer.testnet.whitechain.io" } },
  testnet: true,
});
export const explorerTx = (hash: string) => `https://explorer.testnet.whitechain.io/tx/${hash}`;
export const explorerAddress = (a: string) => `https://explorer.testnet.whitechain.io/address/${a}`;
