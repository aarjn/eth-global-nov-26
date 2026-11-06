import { API_URL } from "./config";

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach PaisaLink right now. Check your connection and try again.", 0, "NETWORK");
  }
  const text = await res.text();
  let data: unknown = undefined;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; message?: string; code?: string };
    throw new ApiError(d.error || d.message || `Request failed (${res.status})`, res.status, d.code);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  url: (path: string) => `${API_URL}${path}`,
};

/** Friendly copy for relayer error codes (PLAN.md section 3). */
export function friendlyError(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case "MERCHANT_NOT_VERIFIED": return "This merchant hasn't finished verification, so free checkout isn't available for them yet.";
      case "BUDGET_EXCEEDED": return "This merchant's free checkout allowance is used up for today. Please try again tomorrow.";
      case "RATE_LIMITED": return "Too many attempts. Please wait a minute and try again.";
      case "BAD_AUTHORIZATION": return "The payment approval didn't match this invoice. Please refresh and try again.";
      case "SIMULATION_FAILED": return "The payment couldn't go through (it was checked before sending, nothing was charged).";
      case "HANDLE_TAKEN": return "That handle is taken. Try another one.";
      case "ARKIV_UNAVAILABLE": return "Our records service is slow right now. Please try again in a few seconds.";
      case "ARKIV_RATE_LIMITED": return "Our records service is busy. Please wait a minute and try again.";
      case "INVOICE_NOT_OPEN": return "This invoice can't be paid any more (it may already be paid).";
      case "PAYMENT_IN_PROGRESS": return "A payment for this invoice is already being processed. Give it a few seconds.";
      case "DEMO_FAUCET_LIMIT": return `Demo funds: ${e.message}.`;
      case "NOT_CONFIGURED": return `PaisaLink isn't fully set up yet: ${e.message}.`;
      case "TX_FAILED": return "The network didn't accept the transaction. Nothing was charged. Please try again.";
    }
    return e.message;
  }
  if (e instanceof Error) {
    if (/User rejected|denied/i.test(e.message)) return "You cancelled the approval.";
    return e.message.split("\n")[0];
  }
  return String(e);
}
