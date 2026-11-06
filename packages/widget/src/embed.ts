// Script-tag loader. Usage on any website:
//   <script src="https://<paisalink-app>/embed.js" data-api="https://<paisalink-api>" defer></script>
//   <button data-paisalink data-amount="49" data-merchant="0x..." data-memo="Order 1001">Pay 49 USDT</button>
// Listen for the result:  window.addEventListener("paisalink:paid", (e) => console.log(e.detail));
import { checkout, DEFAULT_API_URL, type PaidResult } from "./core";

const script = document.currentScript as HTMLScriptElement | null;
const scriptOrigin = script?.src ? new URL(script.src).origin : location.origin;
const apiUrl = script?.dataset.api || DEFAULT_API_URL;
const appUrl = script?.dataset.app || scriptOrigin;

async function start(el: HTMLElement) {
  const { amount, merchant, memo, dueInDays } = el.dataset;
  if (!amount || !merchant) {
    console.error("[paisalink] data-amount and data-merchant are required", el);
    return;
  }
  el.setAttribute("aria-busy", "true");
  try {
    await checkout({
      amount, merchant, memo, apiUrl, appUrl,
      dueInDays: dueInDays ? Number(dueInDays) : undefined,
      onPaid: (r: PaidResult) => el.dispatchEvent(new CustomEvent("paisalink:paid", { detail: r, bubbles: true })),
      onError: (e) => el.dispatchEvent(new CustomEvent("paisalink:error", { detail: e.message, bubbles: true })),
    });
  } catch (e) {
    console.error("[paisalink]", e);
  } finally {
    el.removeAttribute("aria-busy");
  }
}

document.addEventListener("click", (e) => {
  const el = (e.target as Element | null)?.closest?.("[data-paisalink]") as HTMLElement | null;
  if (!el) return;
  e.preventDefault();
  void start(el);
});

(window as unknown as { PaisaLink: unknown }).PaisaLink = {
  checkout: (o: Parameters<typeof checkout>[0]) => checkout({ apiUrl, appUrl, ...o }),
};
