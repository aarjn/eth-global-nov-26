// Initials avatars, after Magic UI "avatar-circles" (MIT, (c) Magic UI, see ./LICENSE.md;
// garage id frontend.components.animated-component-kits). Changes: initials on a warm gradient instead of
// remote images (no network loads), single avatar + stacked group.
import { cn as cx } from "./cn";

const tones = {
  brand: "from-brand-500 to-brand-700 text-white",
  saffron: "from-saffron-400 to-saffron-500 text-ink-900",
  violet: "from-violet-400 to-violet-600 text-white",
  sky: "from-sky-400 to-sky-600 text-white",
  ink: "from-ink-600 to-ink-800 text-white",
} as const;
export type AvatarTone = keyof typeof tones;

/** "priya.designs" -> "Priya" */
export function firstName(handle?: string | null): string | null {
  const w = (handle ?? "").replace(/^@/, "").split(/[._\-\d]/).find(Boolean);
  return w ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : null;
}

export function Avatar({ name, tone = "brand", size = "md", className }: { name?: string | null; tone?: AvatarTone; size?: "sm" | "md" | "lg"; className?: string }) {
  const s = { sm: "size-8 text-xs", md: "size-11 text-lg", lg: "size-14 text-2xl" }[size];
  const initial = (name ?? "").replace(/^@/, "").trim().slice(0, 1).toUpperCase() || "?";
  return <span aria-hidden="true" className={cx("inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-extrabold ring-2 ring-white shadow-sm", tones[tone], s, className)}>{initial}</span>;
}

export function AvatarGroup({ people, className }: { people: { name: string; tone: AvatarTone }[]; className?: string }) {
  return <div className={cx("flex -space-x-2.5", className)}>
    {people.map((p) => <Avatar key={p.name} name={p.name} tone={p.tone} size="sm" />)}
  </div>;
}
