#!/usr/bin/env bash
# Joins the demo clips with the owner's voice-over into one video.
#   in:  recordings/final/ch01.mp4 … ch11.mp4 (public URL patched), else recordings/cut/, else recordings/chNN.mp4
#        (all from scripts/cut-clips.sh) and recordings/audio/ch01.* … ch11.* (any audio format ffmpeg reads)
#   out: recordings/paisalink-demo.mp4 (H.264 1080p30 + AAC)
# Each chapter lasts max(clip, audio): if the audio is longer, the last frame is held; if the clip is longer,
# the voice is padded with silence so no footage is lost. The voice is high-passed and loudness-normalised. A chapter with no audio file keeps its clip length with silence (and a warning).
# Cutting (recordings/cuts.txt) is done by scripts/cut-clips.sh, not here.
# Clip source: recordings/v2/ (all 11 clips) -> writes recordings/paisalink-demo-v2.mp4; otherwise final/, cut/, raw
# -> recordings/paisalink-demo.mp4. Override with MUX_SRC=final|cut|v2.
# Usage: bash scripts/mux-video.sh [recordings-dir]
set -euo pipefail
DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)/recordings}"
OUT="$DIR/paisalink-demo.mp4"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
SRC="$DIR"; [ -d "$DIR/cut" ] && SRC="$DIR/cut"; [ -d "$DIR/final" ] && SRC="$DIR/final"
# v2 (redesigned UI, scripts/cut-v2.ts) wins when all 11 clips exist; it gets its own output file, so
# recordings/paisalink-demo.mp4 (from final/) stays as the fallback.
if [ -z "${MUX_SRC:-}" ] && ls "$DIR"/v2/ch{01,02,03,04,05,06,07,08,09,10,11}.mp4 >/dev/null 2>&1; then
  SRC="$DIR/v2"; OUT="$DIR/paisalink-demo-v2.mp4"
fi
[ -n "${MUX_SRC:-}" ] && SRC="$DIR/$MUX_SRC"   # e.g. MUX_SRC=final to rebuild the v1 video
[ "$SRC" = "$DIR/v2" ] && OUT="$DIR/paisalink-demo-v2.mp4"   # never overwrite the v1 video from v2 clips
echo "clips from $SRC"
dur() { ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$1"; }

: > "$WORK/list.txt"
for n in 01 02 03 04 05 06 07 08 09 10 11; do
  clip="$SRC/ch$n.mp4"
  [ -f "$clip" ] || { echo "missing $clip" >&2; exit 1; }
  audio="$(ls "$DIR"/audio/ch$n.* 2>/dev/null | head -1 || true)"
  vd="$(dur "$clip")"
  seg="$WORK/seg$n.mp4"
  if [ -n "$audio" ]; then
    ad="$(dur "$audio")"
    hold="$(awk -v a="$ad" -v v="$vd" 'BEGIN { d = a - v; printf "%.3f", (d > 0 ? d : 0) }')"
    len="$(awk -v a="$ad" -v v="$vd" 'BEGIN { printf "%.3f", (a > v ? a : v) }')"
    printf 'ch%s  clip %6.2fs  audio %6.2fs  hold %ss  length %ss\n' "$n" "$vd" "$ad" "$hold" "$len"
    ffmpeg -v error -y -i "$clip" -i "$audio" \
      -filter_complex "[0:v]tpad=stop_mode=clone:stop_duration=${hold},trim=duration=${len},setpts=PTS-STARTPTS,scale=1920:1080,fps=30,format=yuv420p[v];[1:a]aresample=48000,highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${len},asetpts=PTS-STARTPTS[a]" \
      -map "[v]" -map "[a]" -c:v libx264 -preset veryfast -crf 18 -r 30 -c:a aac -b:a 192k -ar 48000 -ac 2 "$seg"
  else
    printf 'ch%s  clip %6.2fs  NO AUDIO (silence)\n' "$n" "$vd" >&2
    ffmpeg -v error -y -i "$clip" -f lavfi -i anullsrc=r=48000:cl=stereo \
      -filter_complex "[0:v]scale=1920:1080,fps=30,format=yuv420p[v]" -map "[v]" -map 1:a -t "$vd" \
      -c:v libx264 -preset veryfast -crf 18 -r 30 -c:a aac -b:a 192k -ar 48000 -ac 2 "$seg"
  fi
  echo "file '$seg'" >> "$WORK/list.txt"
done

ffmpeg -v error -y -f concat -safe 0 -i "$WORK/list.txt" -c copy -movflags +faststart "$OUT"
printf 'wrote %s (%.1f s)\n' "$OUT" "$(dur "$OUT")"
