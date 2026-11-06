// Writes a QR code (level M, no quiet zone, 1 px per module) as a binary PPM, for scripts/patch-public-url.sh.
// Same encoder the API uses for the invoice PDF (apps/api/src/pdf.ts).
//   bun scripts/qr-ppm.ts <text> <out.ppm> <dark-hex> <light-hex>
import qrcode from "../apps/api/node_modules/qrcode-generator/dist/qrcode.mjs";

const [text, out, darkHex = "111627", lightHex = "ffffff"] = process.argv.slice(2);
if (!text || !out) throw new Error("usage: bun scripts/qr-ppm.ts <text> <out.ppm> [dark-hex] [light-hex]");
const rgb = (h: string) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
const qr = qrcode(0, "M");
qr.addData(text);
qr.make();
const n = qr.getModuleCount();
const [d, l] = [rgb(darkHex), rgb(lightHex)];
const body = new Uint8Array(n * n * 3);
for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) body.set(qr.isDark(r, c) ? d : l, (r * n + c) * 3);
await Bun.write(out, new Blob([`P6\n${n} ${n}\n255\n`, body]));
console.log(`${out}: ${n}x${n} modules`);
