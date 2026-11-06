// W5 /invest tests. Run from apps/web: `bun test ./src/routes/invest` (apps/web/bunfig.toml preloads happy-dom).
// Pure helpers plus a render of a note card; no chain calls are made (the API fetch fails fast and is ignored).
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { BaseError, ContractFunctionRevertedError, encodeErrorResult, type Abi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { invoiceNoteAbi } from "@paisalink/shared";
import { countdown, decodeRevert, discount, explainRevert, revertLabel, type NoteRow } from "./lib";
import { NoteCard } from "./NoteCard";

afterEach(cleanup);

describe("invest helpers", () => {
  test("countdown", () => {
    expect(countdown(0)).toBe("matured");
    expect(countdown(-5)).toBe("matured");
    expect(countdown(65)).toBe("1:05");
    expect(countdown(120)).toBe("2:00");
    expect(countdown(3 * 3600 + 120)).toBe("3h 2m");
    expect(countdown(2 * 86400 + 3 * 3600)).toBe("2d 3h");
  });

  test("discount: 2,000 face at 1,950 is 2.5%", () => {
    expect(discount("2000", "1950")).toEqual({ pct: 2.5, profit: 50 });
    expect(discount("0", "1")).toEqual({ pct: 0, profit: 0 });
  });

  test("decodes InvoiceNote custom errors from a real ABI-encoded revert", () => {
    const abi = invoiceNoteAbi as Abi;
    const data = encodeErrorResult({ abi, errorName: "MaturityPassed", args: [1_800_000_120n] });
    const err = new BaseError("call reverted", { cause: new ContractFunctionRevertedError({ abi, data, functionName: "transfer" }) });
    const r = decodeRevert(err);
    expect(r.name).toBe("MaturityPassed");
    expect(revertLabel(r)).toBe("MaturityPassed(1800000120)");
    expect(r.text).toContain("Transfers are locked");
    const addr = "0x32c84603C9848FFa470FB07C9bCe820944D04c52";
    const na = decodeRevert(new BaseError("x", { cause: new ContractFunctionRevertedError({ abi, data: encodeErrorResult({ abi, errorName: "NotAllowlisted", args: [addr] }), functionName: "fund" }) }));
    expect(revertLabel(na)).toBe("NotAllowlisted(0x32c8…4c52)");
    expect(explainRevert("NotAllowlisted")).toContain("allowlist");
  });
});

describe("NoteCard", () => {
  const investor = privateKeyToAccount(generatePrivateKey());
  const base: NoteRow = {
    noteId: 7, invoiceId: `0x${"ab".repeat(32)}`, issuer: "0xC038827b4E362B0de1Be859377508613CD028946",
    faceUsdt: "2000", priceUsdt: "1950", maturity: 1_800_000_120, state: "issued", onchain: null,
  };
  const props = { note: "0x2222222222222222222222222222222222222222" as const, investor, investorAllowed: true, investorWbt: 10n ** 16n, onChanged: () => {} };

  test("issued note: price, discount, countdown, fund button and the non-allowlisted proof", () => {
    const { container, getByTestId } = render(<NoteCard row={base} nowSec={1_800_000_000} {...props} />);
    expect(container.textContent).toContain("2.5% discount");
    expect(container.textContent).toContain("Fund for 1,950 USDT");
    expect(container.textContent).toContain("Try to fund from a non-allowlisted wallet");
    expect(getByTestId("countdown").textContent).toBe("2:00");
  });

  test("funded note held by me: transfer-after-maturity proof is locked until maturity, then enabled with settle", () => {
    const funded: NoteRow = { ...base, state: "funded", investor: investor.address,
      onchain: { noteId: 7, invoiceId: base.invoiceId, issuer: base.issuer, holder: investor.address, faceUsdt: "2000", priceUsdt: "1950", escrowUsdt: "2000", maturity: base.maturity, state: "funded", discountPct: 2.5, matured: false, escrowFull: true } };
    const before = render(<NoteCard row={funded} nowSec={1_800_000_000} {...props} />);
    const lockBtn = [...before.container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Try a transfer after maturity"))!;
    expect(lockBtn.disabled).toBe(true);
    expect(lockBtn.textContent).toContain("unlocks in 2:00");
    expect(before.container.textContent).toContain("Transfer");
    cleanup();
    const after = render(<NoteCard row={funded} nowSec={1_800_000_200} {...props} />);
    const btn = [...after.container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Try a transfer after maturity"))!;
    expect(btn.disabled).toBe(false);
    expect(after.container.textContent).toContain("Settle: pay 2,000 USDT to the holder");
  });
});
