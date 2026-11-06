import type { ReactNode } from "react";
import { Link, useLocation } from "../lib/router";
import { cx, Logo } from "./ui";

const nav = [
  { href: "/merchant", label: "Dashboard" },
  { href: "/invest", label: "Finance" },
  { href: "/onboard", label: "Verify" },
  { href: "/demo-store", label: "Demo store" },
];

export function Shell({ children, wide = true }: { children: ReactNode; wide?: boolean }) {
  const { pathname } = useLocation();
  return <div className="min-h-dvh overflow-x-clip bg-canvas">
    <header className="sticky top-0 z-20 border-b border-ink-900/5 bg-white/80 backdrop-blur">
      <div className={cx("mx-auto flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-6", wide ? "max-w-6xl" : "max-w-3xl")}>
        <Link href="/" aria-label="PaisaLink home"><Logo /></Link>
        <nav className="-mx-1 flex w-full flex-wrap gap-0.5 text-[13px] sm:ml-auto sm:w-auto sm:flex-nowrap sm:gap-1 sm:text-sm">
          {nav.map((n) => <Link key={n.href} href={n.href}
            className={cx("whitespace-nowrap rounded-xl px-2.5 py-1.5 font-semibold transition sm:px-3",
              pathname.startsWith(n.href) ? "bg-brand-50 text-brand-800" : "text-ink-600 hover:bg-ink-900/5 hover:text-ink-900")}>{n.label}</Link>)}
        </nav>
      </div>
    </header>
    <main className={cx("mx-auto px-4 py-6 sm:px-6 sm:py-10", wide ? "max-w-6xl" : "max-w-3xl")}>{children}</main>
    <footer className="pb-10 text-center text-xs text-ink-400">PaisaLink · testnet demo · settlement in USDT</footer>
  </div>;
}
