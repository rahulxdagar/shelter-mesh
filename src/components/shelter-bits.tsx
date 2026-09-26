import { cn } from "@/lib/format";
import { TAG_LABEL, type FacilityKind } from "@/lib/types";
import { Badge } from "./ui";

export function TagList({ tags, className }: { tags: string[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {tags.map((t) => (
        <span key={t} className="rounded-md border border-line bg-raised/70 px-1.5 py-0.5 text-[11px] font-medium text-ink-2">
          {TAG_LABEL[t] ?? t}
        </span>
      ))}
    </div>
  );
}

export function KindBadge({ kind }: { kind: FacilityKind }) {
  if (kind === "warming_hub") return <Badge tone="frost">Warming hub</Badge>;
  if (kind === "overflow") return <Badge tone="caution">Overflow</Badge>;
  return null;
}

export function BedCount({ available, total, className }: { available: number; total: number; className?: string }) {
  const tone = available === 0 ? "text-alarm" : available <= 3 ? "text-caution" : "text-go";
  return (
    <div className={cn("text-right leading-none", className)}>
      <div className={cn("font-mono text-2xl font-semibold tabular", tone)}>{available}</div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">of {total} beds</div>
    </div>
  );
}
