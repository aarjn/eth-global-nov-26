import { useState } from "react";
import { cx } from "../../components/ui";

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const t = document.createElement("textarea");
      t.value = text; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return <button type="button" onClick={copy}
    className={cx("shrink-0 rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-ink-800 ring-1 ring-ink-900/10 transition hover:bg-ink-50", done && "text-brand-700", className)}>
    {done ? "Copied" : label}
  </button>;
}
