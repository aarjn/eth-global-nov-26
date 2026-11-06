// USDT on Whitechain testnet (sponsor-required token). Domain verified on chain at hour 0:
// keccak(EIP712Domain(name,version,chainId,verifyingContract)) with ("Tether USD","1",1874,USDT)
// == DOMAIN_SEPARATOR() == 0xcdcfacb6b15c8238b4e5fbb47bdb83b7f83f50a531d264bf9763d2bd1d3d2a25
import type { Address, Eip3009Authorization, Hex } from "./types";
import { WHITECHAIN_TESTNET_ID } from "./chain";

export const USDT_ADDRESS: Address = "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7";
export const USDT_DECIMALS = 6;
export const USDT_DOMAIN_SEPARATOR: Hex = "0xcdcfacb6b15c8238b4e5fbb47bdb83b7f83f50a531d264bf9763d2bd1d3d2a25";
export const USDT_DOMAIN = { name: "Tether USD", version: "1", chainId: WHITECHAIN_TESTNET_ID, verifyingContract: USDT_ADDRESS } as const;

export const RECEIVE_WITH_AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
  ],
} as const;

/** Typed data for USDT receiveWithAuthorization. Used by the widget (sign) and the relayer (verify). */
export function buildReceiveAuthTypedData(a: Eip3009Authorization) {
  return {
    domain: USDT_DOMAIN,
    types: RECEIVE_WITH_AUTHORIZATION_TYPES,
    primaryType: "ReceiveWithAuthorization" as const,
    message: { from: a.from, to: a.to, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce },
  };
}
