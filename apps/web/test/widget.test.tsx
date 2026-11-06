import { afterEach, describe, expect, mock, test } from "bun:test";
import { checkoutUrl, isCheckoutMessage, normalizeAmount, openCheckout } from "@paisalink/react/core";

afterEach(() => { document.body.innerHTML = ""; });

describe("@paisalink/react core", () => {
  test("normalizeAmount accepts USDT amounts and rejects junk", () => {
    expect(normalizeAmount(49)).toBe("49");
    expect(normalizeAmount("12.345678")).toBe("12.345678");
    expect(() => normalizeAmount("1.1234567")).toThrow();
    expect(() => normalizeAmount("0")).toThrow();
    expect(() => normalizeAmount("-5")).toThrow();
  });

  test("checkoutUrl points at the hosted /pay page in embed mode", () => {
    expect(checkoutUrl("0xabc", "https://app.example/")).toBe("https://app.example/pay/0xabc?embed=1");
  });

  test("isCheckoutMessage only accepts PaisaLink messages", () => {
    expect(isCheckoutMessage({ source: "paisalink", type: "close" })).toBe(true);
    expect(isCheckoutMessage({ type: "paid" })).toBe(false);
    expect(isCheckoutMessage(null)).toBe(false);
  });

  test("openCheckout mounts an iframe modal and closes on Escape", () => {
    const onClose = mock(() => {});
    openCheckout("0xabc", { appUrl: "http://localhost:5173", onClose });
    const frame = document.querySelector("iframe");
    expect(frame?.getAttribute("src")).toBe("http://localhost:5173/pay/0xabc?embed=1");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector("iframe")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("openCheckout ignores paid messages from other origins", () => {
    const onPaid = mock(() => {});
    openCheckout("0xabc", { appUrl: "http://localhost:5173", onPaid });
    window.dispatchEvent(new MessageEvent("message", { origin: "https://evil.example", data: { source: "paisalink", type: "paid", invoiceId: "0xabc", txHash: "0x1", explorerUrl: "", receiptUrl: "" } }));
    expect(onPaid).not.toHaveBeenCalled();
  });
});
