import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import { match, useLocation } from "./lib/router";
import { Spinner } from "./components/ui";
import { Shell } from "./components/Shell";
import Home from "./routes/Home";

type Page = LazyExoticComponent<ComponentType<{ params: Record<string, string> }>>;

const MerchantPage = lazy(() => import("./routes/merchant"));
const PayPage = lazy(() => import("./routes/pay"));
const ReceiptPage = lazy(() => import("./routes/receipt"));
const DemoStorePage = lazy(() => import("./routes/demo-store"));

// /invest (W5) and /onboard (W6) are owned by other workstreams. They are picked up
// automatically when src/routes/<name>/index.tsx exists, so this file never needs editing.
const external = import.meta.glob<{ default: ComponentType<{ params: Record<string, string> }> }>("./routes/{invest,onboard}/index.tsx");
const externalPage = (name: string): Page | null => {
  const loader = external[`./routes/${name}/index.tsx`];
  return loader ? lazy(loader) : null;
};
const InvestPage = externalPage("invest");
const OnboardPage = externalPage("onboard");

const routes: [string, Page | null][] = [
  ["/merchant", MerchantPage],
  ["/pay/:id", PayPage],
  ["/r/:id", ReceiptPage],
  ["/demo-store", DemoStorePage],
  ["/invest", InvestPage],
  ["/onboard", OnboardPage],
];

function Loading() {
  return <div className="flex min-h-dvh items-center justify-center text-ink-400"><Spinner className="size-6" /></div>;
}

function ComingSoon({ path }: { path: string }) {
  return <Shell><div className="py-24 text-center"><h1 className="text-2xl font-bold">This section is on its way</h1>
    <p className="mt-2 text-ink-500">{path} is being built right now.</p></div></Shell>;
}

export function App() {
  const { pathname } = useLocation();
  if (pathname === "/" || pathname === "") return <Home />;
  for (const [pattern, Page] of routes) {
    const params = match(pattern, pathname);
    if (!params) continue;
    if (!Page) return <ComingSoon path={pattern} />;
    return <Suspense fallback={<Loading />}><Page params={params} /></Suspense>;
  }
  return <Shell><div className="py-24 text-center"><h1 className="text-2xl font-bold">Page not found</h1>
    <a className="mt-4 inline-block font-semibold text-brand-700" href="/">Go home</a></div></Shell>;
}
