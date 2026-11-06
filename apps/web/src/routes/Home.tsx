import { forwardRef, useRef, type ReactNode } from "react";
import { Shell } from "../components/Shell";
import { Link } from "../lib/router";
import { cx, Logo } from "../components/ui";
import { AnimatedBeam } from "../components/magicui/animated-beam";
import { BlurFade } from "../components/magicui/blur-fade";
import { Avatar, AvatarGroup } from "../components/magicui/avatar";

const features = [
  { e: "🔗", t: "Payment links that just work", d: "Send a link. Your client taps Pay on their phone. No app, no sign-up, no fees for them." },
  { e: "↩️", t: "One-click refunds", d: "Refund all or part of a payment from your dashboard. You never pay network fees." },
  { e: "📒", t: "Accountant-ready export", d: "Download every invoice, payment and refund as a CSV your CA can open in Excel." },
  { e: "💸", t: "Get cash for unpaid invoices", d: "Sell a 30-day invoice to a verified investor today, at a small discount." },
];

export default function Home() {
  return <Shell>
    <section className="grid items-center gap-10 py-6 md:grid-cols-[1.1fr_1fr] md:py-14">
      <BlurFade>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-bold uppercase tracking-wider text-brand-800 shadow-sm ring-1 ring-ink-900/5">
          <span aria-hidden="true">🇮🇳</span> For Indian freelancers &amp; exporters</span>
        <h1 className="mt-4 text-4xl font-extrabold leading-[1.05] tracking-tight text-ink-900 sm:text-6xl">Get paid from abroad <span className="bg-gradient-to-r from-brand-600 to-brand-400 bg-clip-text text-transparent">in minutes</span>, not days.</h1>
        <p className="mt-5 max-w-xl text-lg text-ink-600">PaisaLink turns an invoice into a payment link. Your client pays in USDT, a dollar stablecoin, without fees or set-up. You see it land live.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/merchant" className="rounded-2xl bg-gradient-to-b from-brand-500 to-brand-700 px-5 py-3.5 font-semibold text-white shadow-brand transition hover:from-brand-600 hover:to-brand-800 active:translate-y-px">Open my dashboard</Link>
          <Link href="/demo-store" className="rounded-2xl bg-white px-5 py-3.5 font-semibold text-ink-900 ring-1 ring-ink-900/10 transition hover:bg-ink-50">Try the demo store</Link>
        </div>
        <div className="mt-8 flex items-center gap-3">
          <AvatarGroup people={[{ name: "Priya", tone: "brand" }, { name: "Arjun", tone: "saffron" }, { name: "Meera", tone: "violet" }, { name: "Kabir", tone: "sky" }]} />
          <p className="text-sm text-ink-600">Built for designers, developers and small exporters<br className="hidden sm:block" /> who bill clients in dollars.</p>
        </div>
      </BlurFade>
      <BlurFade delay={0.1} className="relative overflow-x-clip md:overflow-visible">
        <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-gradient-to-br from-brand-200/60 via-white to-saffron-100/70 blur-2xl" />
        <div className="mx-auto w-full max-w-sm rounded-[2rem] bg-white p-6 shadow-card ring-1 ring-ink-900/5 transition md:rotate-[-1.5deg] md:hover:rotate-0">
          <div className="flex items-center gap-3">
            <Avatar name="Priya" />
            <div><p className="text-sm font-bold text-ink-900">@priya.designs</p><p className="text-xs text-ink-500">requests a payment</p></div>
          </div>
          <p className="tabular mt-5 text-5xl font-extrabold tracking-tight">49 <span className="text-2xl text-ink-500">USDT</span></p>
          <p className="mt-1 text-sm text-ink-500">Logo design, 2 revisions</p>
          <div className="mt-6 rounded-2xl bg-gradient-to-b from-brand-500 to-brand-700 py-3.5 text-center font-semibold text-white shadow-brand">Pay now</div>
          <p className="mt-3 text-center text-xs text-ink-400">Illustration</p>
        </div>
      </BlurFade>
    </section>

    <FlowDiagram />

    <section className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {features.map((f, i) => <BlurFade key={f.t} delay={0.05 * i} className="rounded-3xl bg-white p-5 shadow-card ring-1 ring-ink-900/5">
        <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-2xl bg-saffron-50 text-xl ring-1 ring-saffron-100">{f.e}</span>
        <h3 className="mt-3 font-bold text-ink-900">{f.t}</h3><p className="mt-1.5 text-sm text-ink-600">{f.d}</p></BlurFade>)}
    </section>
  </Shell>;
}

const Node = forwardRef<HTMLDivElement, { children: ReactNode; label: string; className?: string }>(({ children, label, className }, ref) =>
  <div className="relative z-10 flex flex-col items-center gap-1.5">
    <div ref={ref} className={cx("flex size-12 items-center justify-center rounded-2xl bg-white text-xl shadow-card ring-1 ring-ink-900/5 sm:size-14", className)}>{children}</div>
    <span className="text-[11px] font-semibold text-ink-600 sm:text-xs">{label}</span>
  </div>);
Node.displayName = "Node";

/** Client -> PaisaLink -> the four networks it uses. Animated beams (Magic UI). */
function FlowDiagram() {
  const box = useRef<HTMLDivElement>(null);
  const client = useRef<HTMLDivElement>(null);
  const hub = useRef<HTMLDivElement>(null);
  const wc = useRef<HTMLDivElement>(null);
  const ar = useRef<HTMLDivElement>(null);
  const sw = useRef<HTMLDivElement>(null);
  const wo = useRef<HTMLDivElement>(null);
  const targets = [
    { ref: wc, label: "Whitechain", hint: "USDT payment", e: "⛓️" },
    { ref: ar, label: "Arkiv", hint: "invoice records", e: "🗂️" },
    { ref: sw, label: "Swarm", hint: "PDF receipts", e: "📄" },
    { ref: wo, label: "World ID", hint: "verified human", e: "🌍" },
  ];
  return <section className="mt-6 rounded-[2rem] bg-white/70 p-5 shadow-card ring-1 ring-ink-900/5 sm:p-8">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-xl font-extrabold tracking-tight">What happens when your client taps Pay</h2>
      <p className="text-sm text-ink-500">One tap for them. Four networks quietly doing the work.</p>
    </div>
    <div ref={box} className="relative mx-auto mt-6 flex max-w-3xl items-center justify-between gap-2">
      <Node ref={client} label="Your client"><span aria-hidden="true">🧑‍💼</span></Node>
      <Node ref={hub} label="PaisaLink" className="size-16 bg-brand-50 ring-brand-200 sm:size-20"><Logo className="[&>span:last-child]:hidden" /></Node>
      <div className="flex flex-col gap-3">
        {targets.map((t) => <div key={t.label} className="relative z-10 flex items-center gap-2">
          <div ref={t.ref} className="flex size-10 items-center justify-center rounded-xl bg-white text-lg shadow-card ring-1 ring-ink-900/5 sm:size-11">{t.e}</div>
          <div className="hidden leading-tight sm:block"><p className="text-sm font-semibold">{t.label}</p><p className="text-xs text-ink-500">{t.hint}</p></div>
          <span className="text-[11px] font-semibold text-ink-600 sm:hidden">{t.label}</span>
        </div>)}
      </div>
      <AnimatedBeam containerRef={box} fromRef={client} toRef={hub} duration={3} />
      {targets.map((t, i) => <AnimatedBeam key={t.label} containerRef={box} fromRef={hub} toRef={t.ref} duration={3} delay={0.4 + i * 0.15} curvature={(1.5 - i) * 18} />)}
    </div>
  </section>;
}
