import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServeFetch, stripPrefix } from "./serve-lib";

let dist: string;
// A tiny fake API (test-only): answers like the Hono app would.
const api = {
  async fetch(r: Request): Promise<Response> {
    const u = new URL(r.url);
    if (r.method === "GET" && u.pathname === "/health") return Response.json({ ok: true, path: u.pathname, q: u.searchParams.get("x") });
    if (r.method === "GET" && u.pathname === "/") return Response.json({ service: "api-root" });
    if (r.method === "POST" && u.pathname === "/echo") return Response.json({ body: await r.json(), xff: r.headers.get("x-forwarded-for") });
    return Response.json({ code: "NOT_FOUND", path: u.pathname }, { status: 404 });
  },
};

beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), "serve-test-"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>spa</title>");
  writeFileSync(join(dist, "assets", "app.js"), "console.log(1)");
  writeFileSync(join(dist, "embed.js"), "/*embed*/");
});
afterAll(() => rmSync(dist, { recursive: true, force: true }));

const serve = () => createServeFetch({ apiFetch: (r) => api.fetch(r), distDir: dist });
const get = (path: string, init?: RequestInit) => serve()(new Request(`http://h${path}`, init));

describe("serve: /api prefix strip", () => {
  test("/api/health -> API /health, query kept", async () => {
    const r = await get("/api/health?x=1");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, path: "/health", q: "1" });
  });
  test("/api and /api/ -> API root", async () => {
    expect(await (await get("/api")).json()).toEqual({ service: "api-root" });
    expect(await (await get("/api/")).json()).toEqual({ service: "api-root" });
  });
  test("unknown API path is the API's JSON 404, not the SPA", async () => {
    const r = await get("/api/nope");
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ code: "NOT_FOUND", path: "/nope" });
  });
  test("POST body passes through; only the last X-Forwarded-For entry is kept", async () => {
    const r = await get("/api/echo", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "6.6.6.6, 1.2.3.4" }, body: JSON.stringify({ a: 1 }) });
    expect(await r.json()).toEqual({ body: { a: 1 }, xff: "1.2.3.4" });
  });
  test("/apifoo is not the API", async () => {
    const r = await get("/apifoo");
    expect(await r.text()).toContain("spa");
  });
  test("stripPrefix keeps method and query", () => {
    const r = stripPrefix(new Request("http://h/api/a/b?c=d", { method: "DELETE" }), "/api");
    expect(r.method).toBe("DELETE");
    expect(new URL(r.url).pathname + new URL(r.url).search).toBe("/a/b?c=d");
  });
});

describe("serve: static web app", () => {
  test("/ is index.html", async () => {
    const r = await get("/");
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("spa");
  });
  test("SPA fallback for client routes", async () => {
    const r = await get("/pay/0xabc");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(await r.text()).toContain("spa");
  });
  test("assets are served with long cache; missing assets 404", async () => {
    const r = await get("/assets/app.js");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toContain("immutable");
    expect((await get("/assets/missing.js")).status).toBe(404);
    expect((await get("/missing.png")).status).toBe(404);
  });
  test("embed.js is cross-origin loadable", async () => {
    const r = await get("/embed.js");
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
  });
  test("no path traversal out of dist", async () => {
    const r = await get("/..%2f..%2fetc%2fpasswd");
    expect(r.status).toBe(404);
  });
  test("non-GET outside /api is refused", async () => {
    expect((await get("/", { method: "POST" })).status).toBe(405);
  });
});
