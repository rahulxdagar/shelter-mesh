"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/format";

type Tone = "primary" | "neutral" | "ghost" | "danger" | "go" | "caution" | "frost";
type Size = "sm" | "md" | "lg" | "xl";

const TONES: Record<Tone, string> = {
  primary: "bg-ice text-void hover:bg-[#8fdcff] shadow-[0_0_0_1px_rgb(111_211_255/0.4)]",
  neutral: "bg-raised text-ink border border-line-strong hover:bg-[#1a212b] hover:border-[#37424f]",
  ghost: "bg-transparent text-ink-2 hover:text-ink hover:bg-raised",
  danger: "bg-alarm text-white hover:bg-[#ff5364] shadow-[0_0_0_1px_rgb(255_59_78/0.5)]",
  go: "bg-go text-void hover:bg-[#4fe3ab]",
  caution: "bg-caution text-void hover:bg-[#fcca45]",
  frost: "bg-frost text-void hover:bg-white",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] rounded-lg gap-1.5",
  md: "h-10 px-4 text-sm rounded-[10px] gap-2",
  lg: "h-12 px-5 text-[15px] rounded-xl gap-2",
  xl: "h-16 px-6 text-lg rounded-2xl gap-3",
};

type ButtonProps = Omit<HTMLMotionProps<"button">, "children"> & {
  tone?: Tone;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { tone = "neutral", size = "md", loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      whileTap={disabled || loading ? undefined : { scale: 0.97 }}
      transition={{ type: "spring", stiffness: 600, damping: 30 }}
      disabled={disabled || loading}
      className={cn(
        "inline-flex select-none items-center justify-center font-semibold tracking-[-0.01em] transition-colors duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ice",
        "disabled:cursor-not-allowed disabled:opacity-40",
        TONES[tone],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" /> : icon}
      {children}
    </motion.button>
  );
});

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-raised hover:text-ink",
        "focus-visible:outline-2 focus-visible:outline-ice disabled:opacity-40",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Panel({
  className,
  children,
  ...rest
}: HTMLMotionProps<"div"> & { children?: ReactNode }) {
  return (
    <motion.div className={cn("rounded-[14px] border border-line bg-panel", className)} {...rest}>
      {children}
    </motion.div>
  );
}

export function PanelHeader({ title, meta, icon }: { title: ReactNode; meta?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
      <div className="flex min-w-0 items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-2">
        {icon}
        <span className="truncate">{title}</span>
      </div>
      {meta ? <div className="shrink-0 text-xs text-muted">{meta}</div> : null}
    </div>
  );
}

type BadgeTone = "neutral" | "ice" | "go" | "caution" | "alarm" | "frost";
const BADGE: Record<BadgeTone, string> = {
  neutral: "bg-raised text-ink-2 border-line-strong",
  ice: "bg-ice-dim/60 text-ice border-ice/25",
  go: "bg-go-dim text-go border-go/25",
  caution: "bg-caution-dim text-caution border-caution/25",
  alarm: "bg-alarm-dim text-alarm border-alarm/30",
  frost: "bg-frost/10 text-frost border-frost/30",
};

export function Badge({ tone = "neutral", className, children }: { tone?: BadgeTone; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md border px-2 text-[11px] font-semibold uppercase tracking-[0.06em]",
        BADGE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[11px] text-muted">{children}</span>;
}

/** Large choice chips for glove-friendly selection. */
export function ChoiceGrid<T extends string>({
  options,
  value,
  onChange,
  columns = 2,
  size = "lg",
}: {
  options: { value: T; label: string; hint?: string }[];
  value: T | T[] | null;
  onChange: (v: T) => void;
  columns?: 2 | 3;
  size?: "md" | "lg";
}) {
  const selected = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v);
  return (
    <div className={cn("grid gap-2", columns === 3 ? "grid-cols-3" : "grid-cols-2")}>
      {options.map((o) => {
        const on = selected(o.value);
        return (
          <motion.button
            type="button"
            key={o.value}
            onClick={() => onChange(o.value)}
            whileTap={{ scale: 0.97 }}
            aria-pressed={on}
            className={cn(
              "relative flex flex-col items-start justify-center rounded-xl border px-3.5 text-left transition-colors",
              size === "lg" ? "min-h-14 py-2.5" : "min-h-11 py-2",
              on
                ? "border-ice bg-ice-dim/50 text-ink shadow-[inset_0_0_0_1px_rgb(111_211_255/0.5)]"
                : "border-line-strong bg-raised text-ink-2 hover:border-[#3a4655] hover:text-ink",
            )}
          >
            <span className={cn("font-semibold", size === "lg" ? "text-[15px]" : "text-sm")}>{o.label}</span>
            {o.hint ? <span className="text-xs text-muted">{o.hint}</span> : null}
          </motion.button>
        );
      })}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{label}</span>
        {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

export function Meter({ value, className, tone }: { value: number; className?: string; tone?: "auto" | "ice" }) {
  const v = Math.max(0, Math.min(100, value));
  const color =
    tone === "ice" ? "bg-ice" : v >= 99 ? "bg-alarm" : v >= 95 ? "bg-caution" : v >= 85 ? "bg-[#f59e0b]/80" : "bg-go";
  return (
    <div className={cn("h-2 overflow-hidden rounded-full bg-raised", className)}>
      <motion.div
        className={cn("h-full rounded-full", color)}
        initial={false}
        animate={{ width: `${v}%` }}
        transition={{ type: "spring", stiffness: 140, damping: 24 }}
      />
    </div>
  );
}

export function EmptyState({ icon, title, body }: { icon: ReactNode; title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="mb-1 flex size-11 items-center justify-center rounded-xl border border-line bg-raised text-muted">{icon}</div>
      <p className="text-sm font-semibold text-ink-2">{title}</p>
      {body ? <p className="max-w-xs text-[13px] text-muted">{body}</p> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-raised", className)} />;
}
