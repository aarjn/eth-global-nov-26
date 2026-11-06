import { test, expect } from "bun:test";
import { hashDomain } from "viem";
import { USDT_DOMAIN, USDT_DOMAIN_SEPARATOR } from "../src";
test("pinned USDT domain matches on-chain DOMAIN_SEPARATOR", () => {
  const d = hashDomain({ domain: USDT_DOMAIN, types: { EIP712Domain: [
    { name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" } ] } });
  expect(d.toLowerCase()).toBe(USDT_DOMAIN_SEPARATOR);
});
