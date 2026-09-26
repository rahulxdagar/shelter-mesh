"use client";

import { Minus, Plus, Users } from "lucide-react";
import { motion } from "framer-motion";
import { ChoiceGrid, Field } from "./ui";
import { cn } from "@/lib/format";
import {
  GENDER_LABEL, NEED_LABEL, SOBRIETY_LABEL, type Gender, type Need, type Sobriety, type Triage,
} from "@/lib/types";

export type TriageDraft = {
  label: string;
  age: number | null;
  gender: Gender | null;
  sobriety: Sobriety | null;
  needs: Need[];
  family: boolean;
};

export const EMPTY_DRAFT: TriageDraft = { label: "", age: null, gender: null, sobriety: null, needs: [], family: false };

export function draftComplete(d: TriageDraft): d is TriageDraft & { age: number; gender: Gender; sobriety: Sobriety } {
  return d.age != null && d.age >= 0 && d.age <= 110 && d.gender != null && d.sobriety != null;
}

export function toTriage(d: TriageDraft): Triage {
  if (!draftComplete(d)) throw new Error("Triage is incomplete");
  return { age: d.age, gender: d.gender, sobriety: d.sobriety, needs: d.needs, family: d.family };
}

export function fromTriage(t: Partial<Triage>, label = ""): TriageDraft {
  return {
    label,
    age: t.age ?? null,
    gender: t.gender ?? null,
    sobriety: t.sobriety ?? null,
    needs: t.needs ?? [],
    family: t.family ?? false,
  };
}

const AGE_PRESETS = [17, 21, 35, 50, 65];

export function TriageForm({
  value,
  onChange,
  dense,
}: {
  value: TriageDraft;
  onChange: (d: TriageDraft) => void;
  dense?: boolean;
}) {
  const set = <K extends keyof TriageDraft>(k: K, v: TriageDraft[K]) => onChange({ ...value, [k]: v });
  const bump = (delta: number) => set("age", Math.max(0, Math.min(110, (value.age ?? 30) + delta)));
  const size = dense ? "md" : "lg";

  return (
    <div className={cn(dense ? "space-y-4" : "space-y-6")}>
      <Field label="Client reference" hint="Initials or nickname — no full names">
        <input
          value={value.label}
          onChange={(e) => set("label", e.target.value.slice(0, 40))}
          placeholder="e.g. J.D. — red parka"
          className={cn(
            "w-full rounded-xl border border-line-strong bg-deep px-3.5 text-[15px] outline-none transition-colors placeholder:text-faint focus:border-ice",
            dense ? "h-11" : "h-14",
          )}
        />
      </Field>

      <Field label="Age" hint={value.age == null ? "Required" : undefined}>
        <div className="flex items-stretch gap-2">
          <motion.button
            type="button"
            whileTap={{ scale: 0.92 }}
            onClick={() => bump(-1)}
            aria-label="Decrease age"
            className={cn("flex shrink-0 items-center justify-center rounded-xl border border-line-strong bg-raised text-ink", dense ? "size-11" : "size-14")}
          >
            <Minus className="size-5" />
          </motion.button>
          <input
            inputMode="numeric"
            value={value.age ?? ""}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 3);
              set("age", digits === "" ? null : Math.min(110, Number(digits)));
            }}
            placeholder="—"
            aria-label="Age"
            className={cn(
              "w-full min-w-0 rounded-xl border border-line-strong bg-deep text-center font-mono font-semibold tabular outline-none focus:border-ice",
              dense ? "h-11 text-xl" : "h-14 text-2xl",
            )}
          />
          <motion.button
            type="button"
            whileTap={{ scale: 0.92 }}
            onClick={() => bump(1)}
            aria-label="Increase age"
            className={cn("flex shrink-0 items-center justify-center rounded-xl border border-line-strong bg-raised text-ink", dense ? "size-11" : "size-14")}
          >
            <Plus className="size-5" />
          </motion.button>
        </div>
        <div className="flex gap-1.5">
          {AGE_PRESETS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => set("age", a)}
              className={cn(
                "h-9 flex-1 rounded-lg border font-mono text-sm transition-colors",
                value.age === a ? "border-ice bg-ice-dim/50 text-ice" : "border-line bg-raised/60 text-muted hover:text-ink",
              )}
            >
              {a}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Gender identity" hint={value.gender == null ? "Required" : undefined}>
        <ChoiceGrid
          size={size}
          columns={dense ? 3 : 2}
          value={value.gender}
          onChange={(g) => set("gender", g)}
          options={(Object.keys(GENDER_LABEL) as Gender[]).map((g) => ({ value: g, label: GENDER_LABEL[g] }))}
        />
      </Field>

      <Field label="Sobriety status" hint={value.sobriety == null ? "Required" : undefined}>
        <ChoiceGrid
          size={size}
          columns={3}
          value={value.sobriety}
          onChange={(s) => set("sobriety", s)}
          options={(Object.keys(SOBRIETY_LABEL) as Sobriety[]).map((s) => ({ value: s, label: SOBRIETY_LABEL[s] }))}
        />
      </Field>

      <Field label="Accessibility & medical">
        <ChoiceGrid
          size={size}
          columns={3}
          value={value.needs}
          onChange={(n) => set("needs", value.needs.includes(n) ? value.needs.filter((x) => x !== n) : [...value.needs, n])}
          options={(Object.keys(NEED_LABEL) as Need[]).map((n) => ({ value: n, label: NEED_LABEL[n] }))}
        />
        <motion.button
          type="button"
          whileTap={{ scale: 0.98 }}
          aria-pressed={value.family}
          onClick={() => set("family", !value.family)}
          className={cn(
            "flex w-full items-center gap-3 rounded-xl border px-3.5 text-left transition-colors",
            dense ? "min-h-11" : "min-h-14",
            value.family ? "border-ice bg-ice-dim/50" : "border-line-strong bg-raised",
          )}
        >
          <Users className={cn("size-5", value.family ? "text-ice" : "text-muted")} />
          <span className="flex-1">
            <span className="block text-[15px] font-semibold">Family with children</span>
            <span className="block text-xs text-muted">Matches family shelters only</span>
          </span>
          <span
            className={cn(
              "relative h-6 w-10 rounded-full transition-colors",
              value.family ? "bg-ice" : "bg-line-strong",
            )}
          >
            <motion.span
              layout
              className="absolute top-1 size-4 rounded-full bg-white"
              style={{ left: value.family ? 20 : 4 }}
              transition={{ type: "spring", stiffness: 600, damping: 32 }}
            />
          </span>
        </motion.button>
      </Field>
    </div>
  );
}
