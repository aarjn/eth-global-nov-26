// Adapted from Magic UI "animated-beam" (MIT, (c) Magic UI, see ./LICENSE.md;
// garage id frontend.components.animated-component-kits). Changes: uses this app's cx(), brand colours by default.
import { useEffect, useId, useState, type RefObject } from "react";
import { motion } from "motion/react";
import { cn as cx } from "./cn";

export interface AnimatedBeamProps {
  className?: string;
  containerRef: RefObject<HTMLElement | null>;
  fromRef: RefObject<HTMLElement | null>;
  toRef: RefObject<HTMLElement | null>;
  curvature?: number;
  reverse?: boolean;
  pathColor?: string;
  pathWidth?: number;
  pathOpacity?: number;
  gradientStartColor?: string;
  gradientStopColor?: string;
  delay?: number;
  duration?: number;
}

export function AnimatedBeam({ className, containerRef, fromRef, toRef, curvature = 0, reverse = false, duration = 4, delay = 0,
  pathColor = "#958e83", pathWidth = 2, pathOpacity = 0.35, gradientStartColor = "#12ae86", gradientStopColor = "#f59e0b" }: AnimatedBeamProps) {
  const id = useId();
  const [pathD, setPathD] = useState("");
  const [dim, setDim] = useState({ width: 0, height: 0 });
  const g = reverse
    ? { x1: ["90%", "-10%"], x2: ["100%", "0%"], y1: ["0%", "0%"], y2: ["0%", "0%"] }
    : { x1: ["10%", "110%"], x2: ["0%", "100%"], y1: ["0%", "0%"], y2: ["0%", "0%"] };

  useEffect(() => {
    const update = () => {
      if (!containerRef.current || !fromRef.current || !toRef.current) return;
      const c = containerRef.current.getBoundingClientRect();
      const a = fromRef.current.getBoundingClientRect();
      const b = toRef.current.getBoundingClientRect();
      setDim({ width: c.width, height: c.height });
      const sx = a.left - c.left + a.width / 2, sy = a.top - c.top + a.height / 2;
      const ex = b.left - c.left + b.width / 2, ey = b.top - c.top + b.height / 2;
      setPathD(`M ${sx},${sy} Q ${(sx + ex) / 2},${sy - curvature} ${ex},${ey}`);
    };
    const ro = new ResizeObserver(update);
    if (containerRef.current) ro.observe(containerRef.current);
    update();
    return () => ro.disconnect();
  }, [containerRef, fromRef, toRef, curvature]);

  return <svg fill="none" width={dim.width} height={dim.height} aria-hidden="true"
    className={cx("pointer-events-none absolute top-0 left-0 transform-gpu stroke-2", className)} viewBox={`0 0 ${dim.width} ${dim.height}`}>
    <path d={pathD} stroke={pathColor} strokeWidth={pathWidth} strokeOpacity={pathOpacity} strokeLinecap="round" />
    <path d={pathD} strokeWidth={pathWidth} stroke={`url(#${id})`} strokeOpacity="1" strokeLinecap="round" />
    <defs>
      <motion.linearGradient className="transform-gpu" id={id} gradientUnits="userSpaceOnUse"
        initial={{ x1: "0%", x2: "0%", y1: "0%", y2: "0%" }} animate={g}
        transition={{ delay, duration, ease: [0.16, 1, 0.3, 1], repeat: Infinity, repeatDelay: 0 }}>
        <stop stopColor={gradientStartColor} stopOpacity="0" />
        <stop stopColor={gradientStartColor} />
        <stop offset="32.5%" stopColor={gradientStopColor} />
        <stop offset="100%" stopColor={gradientStopColor} stopOpacity="0" />
      </motion.linearGradient>
    </defs>
  </svg>;
}
