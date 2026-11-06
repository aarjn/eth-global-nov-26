// Invoice PDF on Swarm (W7's API): POST renders the PDF (no personal data), uploads it, stores swarmRef on the Arkiv entity.
import type { Hex } from "@paisalink/shared";
import { api } from "./api";
import { swarmUrl } from "./config";

export interface PublishResult { swarmRef: string; url: string; cached?: boolean }

export async function publishInvoicePdf(invoiceId: Hex, knownRef?: string): Promise<PublishResult> {
  const r = await api.post<{ swarmRef?: string; url?: string; cached?: boolean }>(`/invoices/${invoiceId}/pdf`);
  const ref = r.swarmRef ?? knownRef;
  const url = r.url ?? (ref ? swarmUrl(ref) : undefined);
  if (!ref || !url) throw new Error("Swarm didn't return a reference for the PDF.");
  return { swarmRef: ref, url, cached: r.cached };
}

export const pdfPreviewUrl = (invoiceId: string) => api.url(`/invoices/${invoiceId}/pdf`);

const AUTO_KEY = "paisalink.swarm.auto-published";
/** Auto-publish at most once per invoice per browser (survives reloads). */
export function claimAutoPublish(invoiceId: string): boolean {
  try {
    const done = new Set<string>(JSON.parse(localStorage.getItem(AUTO_KEY) || "[]"));
    const id = invoiceId.toLowerCase();
    if (done.has(id)) return false;
    done.add(id);
    localStorage.setItem(AUTO_KEY, JSON.stringify([...done].slice(-200)));
    return true;
  } catch { return true; }
}
