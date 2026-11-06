// Browser-local TESTNET DEMO wallets. Keys live only in this browser's localStorage.
// They are labelled "testnet demo wallet" everywhere in the UI. Never use them for real funds.
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Hex } from "@paisalink/shared";

export type WalletRole = "merchant" | "payer" | "investor";
const keyName = (role: WalletRole) => `paisalink.demo-wallet.${role}`;

export function getLocalAccount(role: WalletRole): PrivateKeyAccount {
  let pk = localStorage.getItem(keyName(role)) as Hex | null;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    pk = generatePrivateKey();
    localStorage.setItem(keyName(role), pk);
  }
  return privateKeyToAccount(pk);
}

export function hasLocalAccount(role: WalletRole): boolean {
  return !!localStorage.getItem(keyName(role));
}

/** Replace the demo wallet with a fresh one (e.g. to show a second, unverified merchant). */
export function resetLocalAccount(role: WalletRole): PrivateKeyAccount {
  localStorage.removeItem(keyName(role));
  return getLocalAccount(role);
}
