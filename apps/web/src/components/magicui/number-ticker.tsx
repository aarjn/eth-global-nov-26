// Adapted from Magic UI "number-ticker" (MIT, (c) Magic UI, see ./LICENSE.md;
// garage id frontend.components.animated-component-kits). Changes: animates from the previous value on every
// change (not only once), custom formatter, honours prefers-reduced-motion, renders the final value on first paint
// so text-based tests and screen readers never see a stale number.
import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";
import { useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { cn as cx } from "./cn";

interface NumberTickerProps extends Omit<ComponentPropsWithoutRef<"span">, "children"> {
  value: number;
  format?: (n: number) => string;
  /** Count up from 0 the first time it renders. */
  fromZero?: boolean;
}

const defaultFormat = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export function NumberTicker({ value, format = defaultFormat, fromZero = true, className, ...props }: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const motionValue = useMotionValue(fromZero && !reduce ? 0 : value);
  const spring = useSpring(motionValue, { damping: 40, stiffness: 120 });
  const fmt = useRef(format);
  fmt.current = format;
  const target = useRef(value);
  target.current = value;

  useEffect(() => {
    if (reduce) { motionValue.jump(value); spring.jump(value); return; }
    motionValue.set(value);
  }, [value, reduce, motionValue, spring]);

  useEffect(() => spring.on("change", (latest) => {
    if (!ref.current) return;
    // settle exactly on the target so rounding never leaves e.g. 48.99 on screen
    const n = Math.abs(latest - target.current) < 0.005 ? target.current : latest;
    ref.current.textContent = fmt.current(n);
  }), [spring]);

  return <span ref={ref} className={cx("inline-block tabular-nums", className)} {...props}>{format(fromZero && !reduce ? 0 : value)}</span>;
}
