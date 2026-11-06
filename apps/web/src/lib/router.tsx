import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

const EVT = "paisalink:navigate";

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new Event(EVT));
  window.scrollTo({ top: 0 });
}

export function useLocation() {
  const read = () => ({ pathname: location.pathname, search: location.search });
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const on = () => setLoc(read());
    window.addEventListener("popstate", on);
    window.addEventListener(EVT, on);
    return () => { window.removeEventListener("popstate", on); window.removeEventListener(EVT, on); };
  }, []);
  return loc;
}

export function useQuery(): URLSearchParams {
  const { search } = useLocation();
  return new URLSearchParams(search);
}

/** Match "/pay/:id" against a pathname. Returns params or null. */
export function match(pattern: string, pathname: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const s = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (rest.target && rest.target !== "_self") return;
    if (/^https?:\/\//.test(href) && !href.startsWith(location.origin)) return;
    e.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={handle} {...rest} />;
}
