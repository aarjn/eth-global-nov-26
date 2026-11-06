import { Shell } from "../components/Shell";
import { Link } from "../lib/router";

const features = [
  { t: "Payment links that just work", d: "Send a link. Your client taps Pay on their phone. No app, no sign-up, no fees for them." },
  { t: "One-click refunds", d: "Refund all or part of a payment from your dashboard. You never pay network fees." },
  { t: "Accountant-ready export", d: "Download every invoice, payment and refund as a CSV your CA can open in Excel." },
  { t: "Get cash for unpaid invoices", d: "Sell a 30-day invoice to a verified investor today, at a small discount." },
];

export default function Home() {
  return <Shell>
    <section className="grid items-center gap-10 py-6 md:grid-cols-[1.1fr_1fr] md:py-14">
      <div>
        <span className="inline-flex rounded-full bg-brand-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-brand-800">For Indian freelancers &amp; exporters</span>
        <h1 className="mt-4 text-4xl font-extrabold leading-[1.05] tracking-tight text-ink-900 sm:text-6xl">Get paid from abroad <span className="text-brand-600">in minutes</span>, not days.</h1>
        <p className="mt-5 max-w-xl text-lg text-ink-600">PaisaLink turns an invoice into a payment link. Your client pays in USDT, a dollar stablecoin, without fees or set-up. You see it land live.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/merchant" className="rounded-2xl bg-brand-600 px-5 py-3.5 font-semibold text-white shadow-brand hover:bg-brand-700">Open my dashboard</Link>
          <Link href="/demo-store" className="rounded-2xl bg-white px-5 py-3.5 font-semibold text-ink-900 ring-1 ring-ink-900/10 hover:bg-ink-50">Try the demo store</Link>
        </div>
      </div>
      <div className="relative overflow-x-clip md:overflow-visible">
        <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-gradient-to-br from-brand-200/60 via-white to-amber-100/60 blur-2xl" />
        <div className="mx-auto w-full max-w-sm rounded-[2rem] bg-white p-6 shadow-card ring-1 ring-ink-900/5">
          <p className="text-sm font-semibold text-ink-500">Invoice from @priya.designs</p>
          <p className="tabular mt-2 text-5xl font-extrabold tracking-tight">49 <span className="text-2xl text-ink-500">USDT</span></p>
          <p className="mt-1 text-sm text-ink-500">Logo design, 2 revisions</p>
          <div className="mt-6 rounded-2xl bg-brand-600 py-3.5 text-center font-semibold text-white">Pay now</div>
          <p className="mt-3 text-center text-xs text-ink-400">Illustration</p>
        </div>
      </div>
    </section>
    <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {features.map((f) => <div key={f.t} className="rounded-3xl bg-white p-5 shadow-card ring-1 ring-ink-900/5">
        <h3 className="font-bold text-ink-900">{f.t}</h3><p className="mt-1.5 text-sm text-ink-600">{f.d}</p></div>)}
    </section>
  </Shell>;
}
