import { useRef } from "react";
import { cn } from "@/lib/utils";

/** Six boxes for an authenticator code. Typing, pasting and backspace all work as expected. */
export function CodeInput({ value, onChange, onComplete, autoFocus }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; autoFocus?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const digits = value.replace(/\D/g, "").slice(0, 6);
  const set = (v: string) => { const d = v.replace(/\D/g, "").slice(0, 6); onChange(d); if (d.length === 6) onComplete?.(d); };
  return (
    <div className="relative" onClick={() => ref.current?.focus()}>
      <input ref={ref} autoFocus={autoFocus} inputMode="numeric" autoComplete="one-time-code" value={digits} onChange={(e) => set(e.target.value)}
        className="absolute inset-0 h-full w-full opacity-0" aria-label="Six-digit code" />
      <div className="flex justify-between gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={cn("flex h-11 flex-1 items-center justify-center rounded-lg border bg-surface font-mono text-[18px]", digits.length === i ? "border-accent ring-2 ring-accent/20" : "border-border", !digits[i] && "text-muted/40")}>{digits[i] ?? "0"}</div>
        ))}
      </div>
    </div>
  );
}
