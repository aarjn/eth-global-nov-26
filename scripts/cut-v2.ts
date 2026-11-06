// v2 cut: fits every chapter to its voice clip. Reads recordings/cuts-v2.txt (plan), recordings/v2-src/marks.json
// and raw/<part>.webm (from apps/web/e2e/record/record-demo.ts; set REC_OUT to recordings/v2-src), recordings/audio/chNN.wav (voice).
// Writes recordings/v2/chNN.mp4 (H.264 1080p30, no audio), exactly voice + 1.0 s long (ch01/ch11 cards: + 1.5 s),
// plus recordings/v2/timings.txt and recordings/v2/preview-silent.mp4.
// Hard cuts, real time, never sped up; if the footage runs out, the last frame is held.
//   bun scripts/cut-v2.ts [recordings-dir]
import { $ } from "bun";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DIR = resolve(process.argv[2] || join(import.meta.dir, "../recordings"));
const SRC = join(DIR, "v2-src");
const OUT = join(DIR, "v2");
const FPS = 30;
const BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
mkdirSync(OUT, { recursive: true });

const dur = async (f: string) => Number((await $`ffprobe -v error -show_entries format=duration -of csv=p=0 ${f}`.text()).trim());
const chapters = Array.from({ length: 11 }, (_, i) => `ch${String(i + 1).padStart(2, "0")}`);
const target: Record<string, number> = {};
for (const ch of chapters) {
  const wav = join(DIR, "audio", `${ch}.wav`);
  if (!existsSync(wav)) throw new Error(`missing ${wav}`);
  target[ch] = Math.round(((await dur(wav)) + (ch === "ch01" || ch === "ch11" ? 1.5 : 1.0)) * FPS) / FPS;
}

type Plan = { part: string; mark: string; from: number; to: number | "fill" };
const plan: Record<string, Plan[]> = {};
for (const raw of readFileSync(join(DIR, "cuts-v2.txt"), "utf8").split("\n")) {
  const line = raw.replace(/#.*/, "").trim();
  if (!line) continue;
  const [ch, part, mark, from, to] = line.split(/\s+/);
  (plan[ch] ??= []).push({ part, mark, from: Number(from), to: to === "fill" ? "fill" : Number(to) });
}
const marks: Record<string, { mobile: boolean; wallSec: number; marks: { label: string; t: number }[] }> =
  existsSync(join(SRC, "marks.json")) ? JSON.parse(readFileSync(join(SRC, "marks.json"), "utf8")) : {};

const ENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-r", String(FPS), "-pix_fmt", "yuv420p", "-an"];

async function card(ch: string, d: number, lines: [string, string, number, string, number][]) {
  const vf = lines.map(([text, color, size, font, dy]) =>
    `drawtext=fontfile=${font}:text='${text}':fontcolor=${color}:fontsize=${size}:x=(w-text_w)/2:y=(h/2)${dy >= 0 ? "+" : ""}${dy}`).join(",");
  await $`ffmpeg -v error -y -f lavfi -i color=c=0x0f172a:s=1920x1080:r=${FPS}:d=${d} -vf ${vf + ",format=yuv420p"} ${ENC} ${join(OUT, `${ch}.mp4`)}`;
}

for (const ch of chapters) {
  const T = target[ch];
  if (ch === "ch01") {
    await card(ch, T, [["PaisaLink", "0x34d399", 150, BOLD, -200], ["get paid from abroad in USDT", "white", 72, REG, 10],
      ["Live on Whitechain testnet  ·  ETHGlobal Mumbai 2026", "0x94a3b8", 38, REG, 150]]);
    continue;
  }
  if (ch === "ch11") {
    await card(ch, T, [["PaisaLink", "0x34d399", 110, BOLD, -260], ["Everything shown is live on Whitechain testnet", "white", 60, REG, -60],
      ["Whitechain (USDT settlement + rules)  ·  Arkiv (data)  ·  Swarm (receipts)  ·  World (Proof of Human)", "0x94a3b8", 34, REG, 50],
      ["github.com/aarjn/eth-global-nov-26", "0x34d399", 56, BOLD, 170]]);
    continue;
  }
  // resolve segments to [file, start, end] in video time
  const segs: { file: string; mobile: boolean; s: number; e: number | "fill"; avail: number }[] = [];
  for (const p of plan[ch] ?? []) {
    const m = marks[p.part];
    const file = join(SRC, "raw", `${p.part}.webm`);
    const ev = m?.marks.find((x) => x.label === p.mark);
    if (!m || !ev || !existsSync(file)) { console.warn(`${ch}: skip ${p.part}/${p.mark} (no mark or file)`); continue; }
    const D = await dur(file);
    // Marks count from page creation, which is when the video starts (checked against scene changes in a dry run:
    // events land within ~0.3 s). The tail is NOT aligned: the webm runs on while the context closes.
    const shift = 0;
    const s = Math.max(0, ev.t - shift + p.from);
    const e = p.to === "fill" ? "fill" : Math.min(D, ev.t - shift + p.to);
    segs.push({ file, mobile: m.mobile, s, e, avail: D });
  }
  if (!segs.length) { console.warn(`${ch}: no footage, skipped`); continue; }
  const fixed = segs.reduce((a, g) => a + (g.e === "fill" ? 0 : Math.max(0, g.e - g.s)), 0);
  for (const g of segs) if (g.e === "fill") g.e = Math.min(g.avail, g.s + Math.max(0.5, T - fixed));
  // trim from the end if the fixed parts alone are longer than the target
  let total = segs.reduce((a, g) => a + ((g.e as number) - g.s), 0);
  for (let i = segs.length - 1; total > T && i >= 0; i--) {
    const cut = Math.min(total - T, (segs[i].e as number) - segs[i].s - 0.5);
    if (cut > 0) { segs[i].e = (segs[i].e as number) - cut; total -= cut; }
  }
  const inputs = segs.flatMap((g) => ["-i", g.file]);
  const scale = (m: boolean) => m
    ? "scale=-2:1040:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0f172a"
    : "scale=1920:1080:flags=lanczos";
  const parts = segs.map((g, i) => `[${i}:v]trim=start=${g.s.toFixed(3)}:end=${(g.e as number).toFixed(3)},setpts=PTS-STARTPTS,fps=${FPS},${scale(g.mobile)},setsar=1[p${i}]`).join(";");
  const hold = Math.max(0, T - total);
  const fc = `${parts};${segs.map((_, i) => `[p${i}]`).join("")}concat=n=${segs.length}:v=1:a=0,tpad=stop_mode=clone:stop_duration=${(hold + 1).toFixed(3)},trim=end_frame=${Math.round(T * FPS)},format=yuv420p[v]`;
  await $`ffmpeg -v error -y ${inputs} -filter_complex ${fc} -map ${"[v]"} ${ENC} ${join(OUT, `${ch}.mp4`)}`;
  console.log(`${ch}: target ${T.toFixed(2)} s, footage ${total.toFixed(2)} s, held ${hold.toFixed(2)} s, ${segs.length} segments`);
}

// timings + silent preview with chapter number and countdown
let t = 0;
const rows = ["PaisaLink demo v2: recordings/v2/ (clip = voice + 1.0 s; cards + 1.5 s), 30 fps", "ch    start    length"];
const list: string[] = [];
for (const ch of chapters) {
  const f = join(OUT, `${ch}.mp4`);
  if (!existsSync(f)) continue;
  const d = await dur(f);
  rows.push(`${ch}  ${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}   ${d.toFixed(2)} s`);
  const p = join(OUT, `_prev_${ch}.mp4`);
  const vf = `drawbox=x=iw-330:y=16:w=314:h=96:color=black@0.6:t=fill,drawtext=fontfile=${BOLD}:text='${ch}':x=w-318:y=26:fontsize=30:fontcolor=white,` +
    `drawtext=fontfile=${BOLD}:text='%{eif\\:max(0\\,ceil(${d.toFixed(3)}-t))\\:d} s left':x=w-318:y=66:fontsize=34:fontcolor=0x34d399`;
  await $`ffmpeg -v error -y -i ${f} -vf ${vf} ${ENC} ${p}`;
  list.push(`file '${p}'`);
  t += d;
}
rows.push(`total ${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")} (${t.toFixed(1)} s)`);
writeFileSync(join(OUT, "timings.txt"), rows.join("\n") + "\n");
writeFileSync(join(OUT, "_list.txt"), list.join("\n"));
await $`ffmpeg -v error -y -f concat -safe 0 -i ${join(OUT, "_list.txt")} -c copy -movflags +faststart ${join(DIR, "preview-silent-v2.mp4")}`;
await $`rm -f ${join(OUT, "_list.txt")} ${list.map((l) => l.slice(6, -1))}`;
console.log(rows.join("\n"));
