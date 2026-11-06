// Adapted from Magic UI "blur-fade" (MIT, (c) Magic UI, see ./LICENSE.md;
// garage id frontend.components.animated-component-kits). Changes: trimmed props, any element via `as`,
// short durations so it never delays a state change the demo recorder waits on. Reduced motion is handled
// globally by <MotionConfig reducedMotion="user"> in main.tsx.
import { motion, type HTMLMotionProps } from "motion/react";

interface BlurFadeProps extends HTMLMotionProps<"div"> {
  delay?: number;
  duration?: number;
  offset?: number;
  blur?: string;
}

export function BlurFade({ children, delay = 0, duration = 0.35, offset = 8, blur = "6px", ...props }: BlurFadeProps) {
  return <motion.div
    initial={{ opacity: 0, y: offset, filter: `blur(${blur})` }}
    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
    transition={{ delay: 0.03 + delay, duration, ease: "easeOut" }}
    {...props}>{children}</motion.div>;
}
