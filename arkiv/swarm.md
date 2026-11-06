# Arkiv + Swarm: invoice PDFs

PaisaLink uses both networks. The invoice record and its index live on Arkiv. The invoice document (a PDF) lives on Swarm. The Arkiv entity points to the PDF by its Swarm reference.

## What is on Swarm and what is on Arkiv

| Where | What | Why |
|---|---|---|
| **Swarm** | One PDF per invoice (about 3-7 KB). It holds the invoice id, the merchant handle and wallet, the amount in USDT, the due date (UTC), the memo, a pay link with a QR code, and PaisaLink branding. | It's a file people open and forward. Swarm serves it by content hash from any gateway, and nobody can quietly edit it. A file has no place on a DB-chain (Arkiv allows 128 KiB of `bytes` per entity, and we query nothing inside a PDF). |
| **Arkiv** | The `invoice` entity (schema in [`schema.md`](schema.md)): merchant, invoice id, state, amount, due date, memo, pay tx, and **`swarm_ref`** | Dashboards, the checkout page and the receipt page filter and read these fields live. |

- **The entity field that holds the reference:** `swarm_ref` (an optional `str` attribute) on the **invoice** entity (`packages/arkiv/src/schemas.ts`). In the API's `Invoice` type it's `swarmRef`.
- **No personal data in the PDF:** it has no payer address, no names and no emails. The memo is the merchant's own text, and it's already public on the Arkiv entity.
- **The reference is never encrypted.** We upload with `encrypt: false`. `assertPlainReference` (`apps/api/src/swarm.ts`) only accepts a 64-hex reference and refuses a 128-hex one, because an encrypted reference carries its decryption key and Arkiv entities are public.
- **The same invoice always gives the same reference.** The PDF has no timestamps (`PDFDocument.create({ updateMetadata: false })`). So a re-upload returns the same 64-hex reference, and the Arkiv upsert does nothing.

## Postage stamp, buyer and Bee service

- **Bee service:** the Swarm Foundation public gateway at `https://api.gateway.ethswarm.org` (a Bee node behind `gateway-proxy`). It accepts `POST /bzz` uploads without our own postage batch and stamps them with the gateway operator's batch. We checked this on 6 Nov 2026: the upload returned `201`, and the read-back returned `200 application/pdf` with identical bytes.
- **Postage batch ID:** the gateway's own batch. We can't see it, because the proxy replaces the `swarm-postage-batch-id` header. bee-js sends a placeholder of 64 zeros, `0000…0000`. `GET /swarm/status` reports `batchId: null` in this mode.
- **Who bought it:** the Swarm Foundation, the operator of the public gateway. PaisaLink bought no BZZ, and no PaisaLink wallet holds xBZZ.
- **Using your own batch:** if the Arkiv/Swarm booth hands out a hackathon Bee endpoint and a batch, set `BEE_URL=<bee api url>` and `BEE_BATCH_ID=<64 hex>` in `.env.local`, then restart the API. No code changes are needed. In that mode `GET /swarm/status` shows the batch ID. A custom `BEE_URL` without `BEE_BATCH_ID` turns uploads off with `503 SWARM_NOT_CONFIGURED`. We never fall back to a fake reference.
- **Read links:** `https://api.gateway.ethswarm.org/bzz/<reference>/`. You can change the base with `SWARM_GATEWAY_URL` on the API and `VITE_SWARM_GATEWAY` on the web app.

## Sample

- **A Swarm reference you can open now** (a test invoice PDF from the live test, no personal data):
  `80cdfa6244c831291e78f660d9ffa7676ee2551b2bae0f15027de91e57b6a4eb`
  https://api.gateway.ethswarm.org/bzz/80cdfa6244c831291e78f660d9ffa7676ee2551b2bae0f15027de91e57b6a4eb/
- **Arkiv entity key + its `swarm_ref`:** _not available yet._ It needs a real invoice on Arkiv. Right now that's blocked because the Arkiv writer has 0 tGLM and no access key, and PaymentRouter isn't deployed. After the first `POST /invoices/<id>/pdf` on a real invoice, fill in:
  - invoice id: `0x…`
  - Arkiv entity key: `0x…` (link: Rabdi explorer entity page, as in `arkivUrl` on `GET /invoices/<id>`)
  - `swarm_ref`: `…` → `https://api.gateway.ethswarm.org/bzz/<ref>/`
  - query: `bun run scripts/query.ts <merchant>` lists the invoice (column `swarm` = yes when `swarm_ref` is set).

## Code: upload and read

| File | What it does |
|---|---|
| `apps/api/src/pdf.ts` | `renderInvoicePdf()` uses pdf-lib 1.17.1 with standard fonts and a QR code from qrcode-generator 2.0.4. Routes: `GET /invoices/:id/pdf` returns a preview (no upload). `POST /invoices/:id/pdf[?force=1]` renders the PDF, uploads it to Swarm, writes `swarmRef` to the invoice with `store.upsertInvoice` (Arkiv `swarm_ref`), then calls `ctx.notify` so open dashboards update. |
| `apps/api/src/swarm.ts` | Config from `BEE_URL`, `BEE_BATCH_ID`, `SWARM_GATEWAY_URL` and `SWARM_DISABLED`. Uploads with `bee.file.upload(batch, bytes, name, { contentType, encrypt: false, deferred: false })` and reads with `bee.file.download(ref)` (bee-js 13.2.0). Serves `GET /swarm/status`. Also has a CLI. |
| `apps/web/src/routes/receipt/index.tsx` | Reads `swarmRef` from the invoice (from Arkiv) and shows **Open PDF on Swarm**. |
| `apps/api/test/pdf.test.ts` | 19 unit and route tests, plus 1 live upload-and-read test (`SWARM_LIVE=1`). |

**Errors:** Swarm switched off returns `503 SWARM_NOT_CONFIGURED`. A failed upload (or an encrypted reference) returns `502 SWARM_UPLOAD_FAILED`, and nothing is stored. Uploads are rate-limited to 3 per invoice per hour, 20 per IP per hour and 200 per hour in total, and the API answers `429 RATE_LIMITED` with `Retry-After` when a limit is hit. An invoice that already has a reference returns it (`cached: true`) without uploading again.

## Run one upload and one read

From `apps/api`, with no Swarm env set (that means the public gateway):

```bash
# Upload any file, then read it back (prints reference, link, size, sha256)
bun --env-file=../../.env.local src/swarm.ts upload /path/to/file.pdf application/pdf
bun --env-file=../../.env.local src/swarm.ts read <reference> /tmp/out.pdf

# Live test: render an invoice PDF, upload it, download it, compare the bytes
SWARM_LIVE=1 bun --env-file=../../.env.local test test/pdf.test.ts -t live

# Through the API, for a real invoice (stores swarm_ref on its Arkiv entity)
curl -X POST http://localhost:8787/invoices/<invoiceId>/pdf
curl http://localhost:8787/invoices/<invoiceId>        # -> "swarmRef": "<64 hex>"
curl http://localhost:8787/swarm/status                # service, batch, read base, healthy
```

## Demo video moment

The merchant creates an invoice, then the customer pays on the phone. On the receipt page (`/r/<id>`), **Open PDF on Swarm** opens the PDF from the public gateway. Then the Arkiv explorer shows the same invoice entity with its `swarm_ref` attribute. The bytes are on Swarm and the pointer is on Arkiv.

## Friction

- **Tutorial calls are out of date for bee-js 13.** Snippets online (and our own notes) use `bee.uploadFile(...)`, `bee.downloadFile(...)` and `bee.buyStorage(...)`. In 13.2.0 these are namespaced as `bee.file.upload`, `bee.file.download` and `bee.storage.buy`, and `Bee` itself only declares the namespaces. We found the right calls only by reading `dist/types/modules/*.d.ts`.
- **No local Bee node.** Docker is installed, but our user can't reach `/var/run/docker.sock`, so `bee-factory` and `fdp-play` were out without changing system groups. A local node's references also wouldn't open for judges. The public gateway solved both problems.
- **Upload batch ID is invisible.** The public gateway doesn't expose which postage batch stamped our upload, or for how long. So we can't give a batch ID or a TTL for the gateway path, and we don't know how long the gateway keeps free uploads.
- **Standard PDF fonts only encode WinAnsi.** A memo with `₹` or Devanagari makes pdf-lib throw. We map `₹` to `Rs` and replace other characters with `?`. Embedding a Unicode font with `@pdf-lib/fontkit` would fix this, but it adds about 100 KB+ to every PDF.
