import type { Invoice, Payment } from "@paisalink/shared";

export const CSV_HEADER = ["date", "invoice_id", "memo", "amount_usdt", "currency", "payer", "tx_link", "state", "refund_tx_link", "due_date"] as const;

/** RFC 4180 field, plus spreadsheet formula-injection guard for text that starts with = + - @ tab or CR. */
export function csvField(v: string | number | undefined | null): string {
  let s = v === undefined || v === null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const isoDate = (unixSec: number) => new Date(unixSec * 1000).toISOString().replace(".000Z", "Z");

/** Accountant export: one row per invoice, joined with its payment (if any). Sorted by date, newest first. */
export function buildExportCsv(invoices: Invoice[], payments: Payment[], explorerUrl: string): string {
  const byId = new Map(payments.map((p) => [p.invoiceId.toLowerCase(), p]));
  const rows = invoices.map((inv) => {
    const p = byId.get(inv.invoiceId.toLowerCase());
    const tx = p?.txHash ?? inv.payTx;
    return {
      sortKey: p?.paidAt ?? inv.dueAt,
      cells: [
        p ? isoDate(p.paidAt) : "",
        inv.invoiceId,
        inv.memo,
        inv.amountUsdt,
        "USDT",
        p?.payer ?? "",
        tx ? `${explorerUrl}/tx/${tx}` : "",
        inv.state,
        p?.refundTx ? `${explorerUrl}/tx/${p.refundTx}` : "",
        isoDate(inv.dueAt),
      ],
    };
  });
  rows.sort((a, b) => b.sortKey - a.sortKey);
  // CRLF line endings and a UTF-8 BOM so Excel opens it cleanly; Google Sheets/LibreOffice ignore the BOM.
  return "﻿" + [CSV_HEADER.join(","), ...rows.map((r) => r.cells.map(csvField).join(","))].join("\r\n") + "\r\n";
}
