// Confetti burst, after the Magic UI "confetti" component (MIT, (c) Magic UI, see ./LICENSE.md;
// garage id frontend.components.animated-component-kits), which wraps canvas-confetti (ISC).
// A plain function instead of the component: it fires once on the "Paid" moment. Disabled for prefers-reduced-motion.
import confetti from "canvas-confetti";

const colors = ["#0b7a5c", "#12ae86", "#6de3be", "#f59e0b", "#fbbf24", "#ffffff"];

export function celebrate() {
  if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const base = { colors, disableForReducedMotion: true, zIndex: 50, ticks: 220 } as const;
  void confetti({ ...base, particleCount: 90, spread: 75, startVelocity: 42, origin: { x: 0.5, y: 0.35 } });
  setTimeout(() => {
    void confetti({ ...base, particleCount: 40, angle: 60, spread: 55, origin: { x: 0, y: 0.6 } });
    void confetti({ ...base, particleCount: 40, angle: 120, spread: 55, origin: { x: 1, y: 0.6 } });
  }, 220);
}
