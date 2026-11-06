#!/usr/bin/env bash
# Replaces the private test-server address (100.125.124.63:5173 / :8787) that is visible in the cut clips with the
# public URL, and writes recordings/final/ch01.mp4 … ch11.mp4. Clip lengths are unchanged (same frame count).
# The spots were found with tesseract OCR on every 0.5 s of recordings/cut/ and checked by eye; frame ranges are
# exact (from a brightness trace of each region). Each patch = drawbox in the background colour + drawtext in the
# matching font, and for the payment-link QR codes a new QR of the public link (same encoder and level as the app).
#   ch02 frames 276-395  dashboard "Payment link ready": link field + QR (invoice A)
#   ch06 frames   0-43   same card for invoice B, before the page changes to /invest
#   ch09 frames 102-191  invoice PDF from Swarm: the printed pay link (2 lines) + its QR
#   ch10 frames 498-644  terminal card: curl … /relay  ->  …/api/relay
# Usage: bash scripts/patch-public-url.sh [recordings-dir]   (needs recordings/cut/, from scripts/cut-clips.sh)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${1:-$ROOT/recordings}"
IN="$DIR/cut"; OUT="$DIR/final"
PUB="https://paisalink.tailcdec7a.ts.net"
INV_A=0xd366452babf6ae5515d1392f445a031d999b94fe1d3572a430e6942a6b9eb066
INV_B=0xb7def65ba2b5329c30a27cfb296cf7ba2e39e4ea5f6f3e635ca81d2d359b8b73
MONO=/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf              # browser monospace (ui-monospace) here
COURIER=/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf # Chromium's PDF viewer Courier stand-in
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"
ENC=(-c:v libx264 -preset veryfast -crf 18 -fps_mode passthrough -pix_fmt yuv420p -an)
frames() { ffprobe -v error -count_frames -select_streams v -show_entries stream=nb_read_frames -of csv=p=0 "$1"; }

qr() { # text out.png size dark light
  bun "$ROOT/scripts/qr-ppm.ts" "$1" "$WORK/q.ppm" "$4" "$5" >/dev/null
  ffmpeg -v error -y -i "$WORK/q.ppm" -vf "scale=$3:$3:flags=neighbor" "$2"
}
qr "$PUB/pay/$INV_A" "$WORK/qrA.png" 225 111627 f2f3f7
qr "$PUB/pay/$INV_B" "$WORK/qrB.png" 225 111627 f2f3f7
qr "$PUB/pay/$INV_A" "$WORK/qrPdf.png" 214 121726 ffffff
printf '%s' "$PUB/pay/0x…" > "$WORK/field.txt"
url="$PUB/pay/$INV_A"
printf '%s' "${url:0:64}" > "$WORK/pdf1.txt"; printf '%s' "${url:64}" > "$WORK/pdf2.txt"
printf '%s' "\$ curl -X POST $PUB/api/relay # gasless payment for the unverified merchant" > "$WORK/curl.txt"

# dashboard payment-link card (ch02, ch06): field text + QR
card() { # in out qr.png first last
  local en="enable='between(n,$4,$5)'"
  ffmpeg -v error -y -i "$1" -i "$3" -filter_complex "[0:v]drawbox=x=266:y=958:w=342:h=32:color=0xF2F3F7:t=fill:$en,\
drawtext=fontfile=$MONO:textfile=$WORK/field.txt:fontsize=13:fontcolor=0x3C4356:x=272:y=968:$en[b];\
[b][1:v]overlay=x=365:y=645:$en[v]" -map "[v]" "${ENC[@]}" "$2"
}
card "$IN/ch02.mp4" "$OUT/ch02.mp4" "$WORK/qrA.png" 276 395
card "$IN/ch06.mp4" "$OUT/ch06.mp4" "$WORK/qrB.png" 0 43

# invoice PDF (ch09): printed link on two lines + QR (bottom rows run off the frame, as in the original)
en="enable='between(n,102,191)'"
ffmpeg -v error -y -i "$IN/ch09.mp4" -i "$WORK/qrPdf.png" -filter_complex "[0:v]drawbox=x=712:y=990:w=630:h=60:color=white:t=fill:$en,\
drawtext=fontfile=$COURIER:textfile=$WORK/pdf1.txt:fontsize=15.6:fontcolor=0x0D8C6B:x=718:y=997:$en,\
drawtext=fontfile=$COURIER:textfile=$WORK/pdf2.txt:fontsize=15.6:fontcolor=0x0D8C6B:x=718:y=1020:$en[b];\
[b][1:v]overlay=x=1381:y=871:$en[v]" -map "[v]" "${ENC[@]}" "$OUT/ch09.mp4"

# terminal card (ch10)
en="enable='between(n,498,644)'"
ffmpeg -v error -y -i "$IN/ch10.mp4" -vf "drawbox=x=70:y=76:w=1850:h=42:color=0x0F172A:t=fill:$en,\
drawtext=fontfile=$MONO:textfile=$WORK/curl.txt:fontsize=28:fontcolor=0x94A3B8:x=80:y=84:$en" "${ENC[@]}" "$OUT/ch10.mp4"

for n in 01 03 04 05 07 08 11; do cp "$IN/ch$n.mp4" "$OUT/ch$n.mp4"; done
for n in 01 02 03 04 05 06 07 08 09 10 11; do
  a="$(frames "$IN/ch$n.mp4")"; b="$(frames "$OUT/ch$n.mp4")"
  [ "$a" = "$b" ] || { echo "ch$n frame count changed: $a -> $b" >&2; exit 1; }
done
echo "final clips in $OUT (frame counts match cut/)"
