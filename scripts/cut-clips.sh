#!/usr/bin/env bash
# Cuts recordings/chNN.mp4 to the ranges in recordings/cuts.txt and writes recordings/cut/chNN.mp4
# (H.264 1080p30, no audio). Hard cuts only, real time, never sped up. Then runs scripts/patch-public-url.sh
# (recordings/final/: the test-server IP replaced by the public URL, same lengths) and builds:
#   recordings/preview-silent.mp4  all cut clips joined, chapter number + countdown in the top-right corner
#   recordings/timings.txt         start, length and word budget (2.5 words/s) of each chapter
# Usage: bash scripts/cut-clips.sh [recordings-dir]
set -euo pipefail
DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)/recordings}"
CUTS="$DIR/cuts.txt"
OUTD="$DIR/cut"
FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUTD"
dur() { ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$1"; }
ENC=(-c:v libx264 -preset veryfast -crf 18 -r 30 -pix_fmt yuv420p -an)
# chapter titles for the preview overlay
TITLES=("" "Title" "Create invoice" "Phone pays + explorer" "Paid + refund" "CSV + demo store" "Sell + fund note"
        "Rule - transfer refused" "Settle" "Swarm receipt + Arkiv" "World ID" "End card")

for n in 01 02 03 04 05 06 07 08 09 10 11; do
  src="$DIR/ch$n.mp4"
  lines="$(grep -E "^ch$n " "$CUTS" 2>/dev/null | sed 's/#.*//' || true)"
  if [ -z "$lines" ]; then
    ffmpeg -v error -y -i "$src" -vf "scale=1920:1080,fps=30" "${ENC[@]}" "$OUTD/ch$n.mp4"
    continue
  fi
  parts=""; ins=""; k=0; hold=0
  while read -r _ a b c _rest; do
    [ -z "${a:-}" ] && continue
    if [ "$a" = "hold" ]; then hold="$b"; continue; fi
    zoom=""
    case "${c:-}" in crop=*) zoom=",${c},scale=1920:1080:flags=lanczos" ;; esac
    parts="$parts[0:v]trim=start=$a:end=$b,setpts=PTS-STARTPTS${zoom},setsar=1[p$k];"
    ins="$ins[p$k]"; k=$((k+1))
  done <<< "$lines"
  tail="format=yuv420p"
  [ "$hold" != "0" ] && tail="tpad=stop_mode=clone:stop_duration=$hold,format=yuv420p"
  ffmpeg -v error -y -i "$src" -filter_complex "${parts}${ins}concat=n=$k:v=1:a=0,fps=30,$tail[v]" -map "[v]" "${ENC[@]}" "$OUTD/ch$n.mp4"
done

# replace the private test-server address with the public URL: recordings/final/ (same frame counts as cut/)
bash "$(dirname "$0")/patch-public-url.sh" "$DIR"
PREV="$DIR/final"

# timings + silent preview (from final/) with chapter number and countdown
words_for() { # word budget at 2.5 words/s, rounded down
  awk -v d="$1" 'BEGIN { printf "%d", d * 2.5 }'
}
{
  printf 'PaisaLink demo: final clips (recordings/final/ = cut/ + public URL patch), real time, 30 fps. Word budget = length x 2.5 words/s.\n'
  printf '%-4s  %-8s  %-7s  %-6s  %s\n' "ch" "start" "length" "words" "shows"
} > "$DIR/timings.txt"
: > "$WORK/list.txt"
t=0
for n in 01 02 03 04 05 06 07 08 09 10 11; do
  c="$PREV/ch$n.mp4"; d="$(dur "$c")"; i=$((10#$n))
  printf '%-4s  %-8s  %-7s  %-6s  %s\n' "ch$n" "$(awk -v t="$t" 'BEGIN { printf "%d:%04.1f", t/60, t%60 }')" \
    "$(printf '%.1f s' "$d")" "$(words_for "$d")" "${TITLES[$i]}" >> "$DIR/timings.txt"
  label="ch$n  ${TITLES[$i]}"
  ffmpeg -v error -y -i "$c" -vf "drawbox=x=iw-560:y=16:w=544:h=96:color=black@0.6:t=fill,\
drawtext=fontfile=$FONT:text='$label':x=w-548:y=26:fontsize=30:fontcolor=white,\
drawtext=fontfile=$FONT:text='%{eif\:max(0\,ceil($d-t))\:d} s left':x=w-548:y=66:fontsize=34:fontcolor=0x34d399" \
    "${ENC[@]}" "$WORK/p$n.mp4"
  echo "file '$WORK/p$n.mp4'" >> "$WORK/list.txt"
  t="$(awk -v t="$t" -v d="$d" 'BEGIN { print t + d }')"
done
printf 'total %s\n' "$(awk -v t="$t" 'BEGIN { printf "%d:%04.1f (%.1f s)", t/60, t%60, t }')" >> "$DIR/timings.txt"
ffmpeg -v error -y -f concat -safe 0 -i "$WORK/list.txt" -c copy -movflags +faststart "$DIR/preview-silent.mp4"
cat "$DIR/timings.txt"
