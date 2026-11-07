import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../../lib/api";
import source from "./StoreCheckout.tsx?raw";
import StoreCheckout from "./StoreCheckout";
import { getLocalAccount } from "../../lib/wallet";
import { short } from "../../lib/format";
import { Link } from "../../lib/router";
import { CopyButton } from "../merchant/CopyButton";
import { DEMO_PRICE } from "../../lib/config";

const embedSnippet = (origin: string, api: string, price: string) => `<script src="${origin}/embed.js" data-api="${api}" defer></script>
<button data-paisalink data-amount="${price}" data-merchant="0x…">Pay ${price} USDT</button>`;

export default function DemoStore() {
  // The shop pays the merchant set in VITE_STORE_MERCHANT, else this browser's demo merchant
  // (so a payment here shows up live on /merchant in the same browser).
  const merchant = useMemo(() => import.meta.env.VITE_STORE_MERCHANT || getLocalAccount("merchant").address, []);
  const [tab, setTab] = useState<"react" | "html">("react");
  const [unregistered, setUnregistered] = useState(false);
  useEffect(() => {
    api.get(`/merchants/${merchant}`).then(() => setUnregistered(false))
      .catch((e) => setUnregistered(e instanceof ApiError && e.status === 404));
  }, [merchant]);
  const lines = source.trimEnd().split("\n");
  const code = tab === "react" ? source.trimEnd() : embedSnippet(location.origin, import.meta.env.VITE_API_URL || "http://localhost:8787", DEMO_PRICE);

  return <div className="min-h-dvh overflow-x-clip bg-[#fbf7f1] text-stone-900">
    <div className="bg-stone-900 py-2 text-center text-xs font-semibold text-stone-100">
      Chhaap & Co. uses PaisaLink checkout · Whitechain testnet · <Link href="/merchant" className="underline">PaisaLink dashboard</Link>
    </div>
    <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
      <span className="font-serif text-2xl font-bold tracking-tight">Chhaap <span className="text-orange-700">&amp;</span> Co.</span>
      <nav className="hidden gap-6 text-sm font-medium text-stone-600 sm:flex"><span>Totes</span><span>Scarves</span><span>Home</span><span>Cart (1)</span></nav>
    </header>

    <main className="mx-auto grid max-w-6xl gap-8 px-5 pb-16 lg:grid-cols-[1fr_1.15fr]">
      <section className="grid gap-6 sm:grid-cols-[1fr_1fr] lg:grid-cols-1 xl:grid-cols-[1fr_1fr]">
        <div className="relative aspect-square overflow-hidden rounded-[2rem] bg-gradient-to-br from-orange-200 via-amber-100 to-rose-200">
          <svg viewBox="0 0 200 200" className="absolute inset-0 m-auto size-3/4" aria-hidden="true">
            <path d="M60 70 Q60 40 100 40 Q140 40 140 70" fill="none" stroke="#7c2d12" strokeWidth="6" />
            <rect x="40" y="70" width="120" height="110" rx="10" fill="#fff7ed" stroke="#7c2d12" strokeWidth="4" />
            {[0, 1, 2].map((r) => [0, 1, 2].map((c) => <circle key={`${r}${c}`} cx={70 + c * 30} cy={100 + r * 28} r="9" fill="none" stroke="#c2410c" strokeWidth="3" />))}
          </svg>
          <span className="absolute left-4 top-4 rounded-full bg-white/80 px-3 py-1 text-xs font-bold">Handmade in Jaipur</span>
        </div>
        <div className="flex flex-col">
          <p className="text-sm font-semibold uppercase tracking-wider text-orange-800">Block-print collection</p>
          <h1 className="mt-2 font-serif text-4xl font-bold leading-tight">Dabu indigo tote bag</h1>
          <p className="mt-3 text-stone-600">Hand-stamped with carved teak blocks on organic cotton. Ships worldwide from Jaipur.</p>
          <p className="mt-5 text-4xl font-extrabold">${DEMO_PRICE} <span className="text-base font-semibold text-stone-500">paid as {DEMO_PRICE} USDT</span></p>
          <div className="mt-6 font-bold text-emerald-800 [&_a]:underline"><StoreCheckout merchant={merchant} amount={DEMO_PRICE} /></div>
          {unregistered && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
            This shop pays your dashboard's merchant, which has no profile yet. <Link href="/merchant" className="underline">Create a handle on the dashboard</Link> first.</p>}
          <p className="mt-4 text-xs text-stone-500">Pays merchant <span className="font-mono">{short(merchant)}</span>{import.meta.env.VITE_STORE_MERCHANT ? "" : " (this browser's merchant wallet)"}.</p>
        </div>
      </section>

      <section className="min-w-0">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-xl font-bold">The whole integration</h2>
            <p className="text-sm text-stone-600"><b>{lines.length} lines</b> of React: this is the exact file that renders the button on the left.</p>
          </div>
          <div className="flex rounded-xl bg-stone-200/70 p-1 text-xs font-semibold">
            {(["react", "html"] as const).map((t) => <button key={t} type="button" onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 ${tab === t ? "bg-white shadow" : "text-stone-600"}`}>{t === "react" ? "React" : "Script tag"}</button>)}
          </div>
        </div>
        <div className="relative mt-4 overflow-hidden rounded-3xl bg-[#0f1424] shadow-xl ring-1 ring-black/10">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
            <span className="font-mono text-xs text-slate-400">{tab === "react" ? "src/StoreCheckout.tsx" : "index.html"}</span>
            <CopyButton text={code} className="bg-white/10 text-white ring-white/10 hover:bg-white/20" />
          </div>
          <pre className="overflow-x-auto p-4 text-[13px] leading-6"><code>{code.split("\n").map((l, i) =>
            <div key={i} className="flex"><span className="mr-4 inline-block w-6 shrink-0 select-none text-right text-slate-600">{i + 1}</span><span className="whitespace-pre text-slate-200">{highlight(l)}</span></div>)}</code></pre>
        </div>
        <p className="mt-3 text-xs text-stone-500">Install: <span className="font-mono">bun add @paisalink/react</span>. The widget creates the invoice, opens a hosted checkout, and calls <span className="font-mono">onPaid</span> with the receipt link.</p>
      </section>
    </main>
  </div>;
}

/** Tiny highlighter: strings, keywords and JSX tags. Enough for a readable slide. */
function highlight(line: string) {
  const parts = line.split(/("[^"]*"|\b(?:import|from|export|default|function|const|return|if|type)\b|<\/?[A-Za-z][\w.]*|\/\/.*$)/g);
  return parts.map((p, i) => {
    if (!p) return null;
    if (p.startsWith("//")) return <span key={i} className="text-slate-500">{p}</span>;
    if (p.startsWith('"')) return <span key={i} className="text-amber-300">{p}</span>;
    if (p.startsWith("<")) return <span key={i} className="text-sky-300">{p}</span>;
    if (/^(import|from|export|default|function|const|return|if|type)$/.test(p)) return <span key={i} className="text-fuchsia-300">{p}</span>;
    return <span key={i}>{p}</span>;
  });
}
