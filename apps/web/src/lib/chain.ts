import { createPublicClient, formatUnits, http, parseUnits } from "viem";
import { USDT_ADDRESS, USDT_DECIMALS, whitechainTestnet, type Address } from "@paisalink/shared";

export const publicClient = createPublicClient({ chain: whitechainTestnet, transport: http() });

const erc20BalanceOf = [{
  type: "function", name: "balanceOf", stateMutability: "view",
  inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }],
}] as const;

export async function usdtBalance(owner: Address): Promise<bigint> {
  return publicClient.readContract({ address: USDT_ADDRESS, abi: erc20BalanceOf, functionName: "balanceOf", args: [owner] });
}

export const parseUsdt = (s: string) => parseUnits(s, USDT_DECIMALS);
export const formatUsdt = (v: bigint) => formatUnits(v, USDT_DECIMALS);
