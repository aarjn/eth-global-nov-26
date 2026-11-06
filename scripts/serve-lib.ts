// One-port production server pieces (used by scripts/serve.ts; tested in scripts/serve.test.ts).
// - /api and /api/* go to the Hono API with the prefix stripped (/api/health -> /health).
// - Everything else is the built web app (apps/web/dist), with an SPA fallback to index.html.
import { statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";

export type ApiFetch = (req: Request, server?: unknown) => Response | Promise<Response>;

export interface ServeOptions {
  apiFetch: ApiFetch;
  /** Absolute or relative path to the vite build output. */
  distDir: string;
  /** Path prefix of the API (default "/api"). */
  apiPrefix?: string;
}

/** The request with `prefix` removed from its path; the query string, method, headers and body stay. */
export function stripPrefix(req: Request, prefix: string): Request {
  const url = new URL(req.url);
  url.pathname = url.pathname.slice(prefix.length) || "/";
  const headers = new Headers(req.headers);
  // Only the hop in front of us (the Tailscale sidecar) is trusted: keep the last X-Forwarded-For entry, which that
  // proxy appended, so a client can't pick its own rate-limit bucket by sending the header itself.
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const last = xff.split(",").map((s) => s.trim()).filter(Boolean).pop();
    if (last) headers.set("x-forwarded-for", last);
    else headers.delete("x-forwarded-for");
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? req.body : undefined,
    signal: req.signal,
    redirect: req.redirect,
    // required by the fetch spec when a stream body is passed on
    ...(hasBody ? { duplex: "half" } : {}),
  } as RequestInit);
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

export function createServeFetch(opts: ServeOptions) {
  const prefix = (opts.apiPrefix ?? "/api").replace(/\/+$/, "");
  const root = resolve(opts.distDir);
  const indexHtml = join(root, "index.html");

  return async function serveFetch(req: Request, server?: unknown): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      return opts.apiFetch(stripPrefix(req, prefix), server);
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response("method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      return new Response("bad path", { status: 400 });
    }
    const target = normalize(join(root, decoded));
    if (target !== root && !target.startsWith(root + sep)) {
      return new Response("not found", { status: 404 });
    }
    if (isFile(target)) {
      const headers: Record<string, string> = {
        "cache-control": decoded.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      };
      if (decoded === "/embed.js") headers["access-control-allow-origin"] = "*";
      return new Response(Bun.file(target), { headers });
    }
    // A missing file with an extension (or under /assets/) is a real 404, not the SPA.
    if (decoded.startsWith("/assets/") || extname(decoded)) {
      return new Response("not found", { status: 404 });
    }
    return new Response(Bun.file(indexHtml), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
  };
}
