// Adapted from Magic UI "shimmer-button" (MIT, (c) Magic UI, see ./LICENSE.md;
// garage id frontend.components.animated-component-kits). Changes: PaisaLink brand defaults, disabled state,
// shimmer pauses while disabled, uses this app's cx() helper.
import { forwardRef, type ComponentPropsWithoutRef, type CSSProperties } from "react";
import { cn as cx } from "./cn";

export interface ShimmerButtonProps extends ComponentPropsWithoutRef<"button"> {
  shimmerColor?: string;
  shimmerSize?: string;
  borderRadius?: string;
  shimmerDuration?: string;
  background?: string;
}

export const ShimmerButton = forwardRef<HTMLButtonElement, ShimmerButtonProps>(({
  shimmerColor = "#d1fae9", shimmerSize = "0.08em", shimmerDuration = "3s", borderRadius = "1rem",
  background = "linear-gradient(135deg, #0b7a5c 0%, #0a6a50 100%)", className, children, style, disabled, ...props
}, ref) => (
  <button ref={ref} disabled={disabled}
    style={{ "--spread": "90deg", "--shimmer-color": shimmerColor, "--radius": borderRadius, "--speed": shimmerDuration,
      "--cut": shimmerSize, "--bg": background, ...style } as CSSProperties}
    className={cx(
      "group relative z-0 flex cursor-pointer items-center justify-center gap-2 overflow-hidden [border-radius:var(--radius)] border border-white/10 px-6 py-3 whitespace-nowrap font-semibold text-white [background:var(--bg)] shadow-brand",
      "transform-gpu transition-transform duration-300 ease-in-out active:translate-y-px",
      "disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
      className)}
    {...props}>
    {/* spark container */}
    <div className={cx("-z-30 blur-[2px]", "@container-[size] absolute inset-0 overflow-visible", disabled && "hidden")}>
      <div className="animate-shimmer-slide absolute inset-0 aspect-[1] h-[100cqh] rounded-none [mask:none]">
        <div className="animate-spin-around absolute -inset-full w-auto [translate:0_0] rotate-0 [background:conic-gradient(from_calc(270deg-(var(--spread)*0.5)),transparent_0,var(--shimmer-color)_var(--spread),transparent_var(--spread))]" />
      </div>
    </div>
    {children}
    {/* highlight */}
    <div className="pointer-events-none absolute inset-0 size-full [border-radius:var(--radius)] shadow-[inset_0_-8px_10px_#ffffff1f] transform-gpu transition-all duration-300 ease-in-out group-hover:shadow-[inset_0_-6px_10px_#ffffff3f] group-active:shadow-[inset_0_-10px_10px_#ffffff3f]" />
    {/* backdrop */}
    <div className="absolute inset-(--cut) -z-20 [border-radius:var(--radius)] [background:var(--bg)]" />
  </button>
));
ShimmerButton.displayName = "ShimmerButton";
