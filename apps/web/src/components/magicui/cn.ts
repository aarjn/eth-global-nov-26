// Class-name joiner for the Magic UI copies (stands in for their `cn` from @/lib/utils).
export function cn(...c: (string | false | null | undefined)[]) { return c.filter(Boolean).join(" "); }
