"use client";

import { AnimatePresence, motion } from "motion/react";
import { Spoon } from "./Spoon";
import { SLOTS, bySlot, totals, type DayState, type PlanItem } from "@/lib/spoons";

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));

const spring = { type: "spring", stiffness: 380, damping: 32, mass: 0.8 } as const;

function SpoonMeter({ day }: { day: DayState }) {
  const t = totals(day);
  const slots = Math.max(t.budget, 10);
  const left = Math.max(0, t.left);
  const borrowedCount = Math.ceil(t.borrowed);

  return (
    <div className="flex flex-wrap items-end gap-x-[5px] gap-y-2" aria-hidden="true">
      {Array.from({ length: slots }, (_, i) => {
        const inBudget = i < t.budget;
        const fill = inBudget ? Math.max(0, Math.min(1, left - i)) : 0;
        return (
          <motion.div
            key={i}
            initial={false}
            animate={{
              opacity: inBudget ? 1 : 0.18,
              y: fill > 0 ? 0 : 3,
              scale: fill > 0 ? 1 : 0.94,
            }}
            transition={{ ...spring, delay: inBudget ? i * 0.025 : 0 }}
          >
            <Spoon fill={fill} tone={fill > 0 ? "full" : "used"} className="h-9 w-[14px] sm:h-11 sm:w-[17px]" />
          </motion.div>
        );
      })}
      <AnimatePresence>
        {Array.from({ length: borrowedCount }, (_, i) => (
          <motion.div
            key={`b${i}`}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={spring}
          >
            <Spoon tone="borrowed" className="h-9 w-[14px] sm:h-11 sm:w-[17px]" />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function CostPips({ spoons }: { spoons: number }) {
  const whole = Math.floor(spoons);
  const half = spoons - whole >= 0.5;
  return (
    <span className="flex items-end gap-[2px]" aria-hidden="true">
      {Array.from({ length: Math.min(whole, 8) }, (_, i) => (
        <Spoon key={i} className="h-4 w-[6px]" />
      ))}
      {half && <Spoon fill={0.5} className="h-4 w-[6px]" />}
    </span>
  );
}

function Item({ item }: { item: PlanItem }) {
  if (item.kind === "rest") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--color-rest)]/20 bg-[var(--color-rest)]/[0.07] px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2 w-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-[var(--color-rest)]/50 [animation-duration:2.4s]" />
            <span className="relative h-2 w-2 rounded-full bg-[var(--color-rest)]" />
          </span>
          <span className="text-[15px] text-[var(--color-rest)]">Rest · {item.minutes} min</span>
        </div>
        <span className="font-mono text-sm tabular-nums text-[var(--color-rest)]">+{fmt(item.credit)}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.035] px-4 py-3 backdrop-blur-sm">
      <div className="min-w-0">
        <div className="truncate text-[15px] font-medium text-white/90">{item.name}</div>
        {item.note && <div className="truncate text-[13px] text-white/40">{item.note}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <CostPips spoons={item.spoons} />
        <span className="w-8 text-right font-mono text-sm tabular-nums text-white/70">{fmt(item.spoons)}</span>
      </div>
    </div>
  );
}

const CRASH_COPY = {
  high: { label: "Crash risk tomorrow", tone: "warn" },
  moderate: { label: "Watch tomorrow", tone: "warn" },
  low: { label: "Crash risk eased", tone: "rest" },
} as const;

export function DayPlan({ day }: { day: DayState }) {
  const t = totals(day);
  const groups = bySlot(day.items);
  const hasEnergy = day.energy !== null;
  const over = t.left < 0;

  return (
    <div className="flex flex-col gap-7">
      {/* Budget */}
      <div className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-[13px] uppercase tracking-[0.14em] text-white/40">
              {over ? "Borrowed from tomorrow" : "Spoons left"}
            </div>
            <div className="mt-1 flex items-baseline gap-3">
              <motion.span
                key={`${fmt(over ? t.borrowed : t.left)}-${hasEnergy}`}
                initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
                className={`font-serif text-6xl leading-none tabular-nums sm:text-7xl ${over ? "text-[var(--color-warn)]" : "text-white"}`}
              >
                {hasEnergy ? fmt(over ? t.borrowed : t.left) : "–"}
              </motion.span>
              {hasEnergy && <span className="text-white/40">of {t.budget}</span>}
            </div>
          </div>
          <div className="text-right text-[13px] leading-5 text-white/40">
            {hasEnergy ? (
              <>
                <div>
                  Energy <span className="text-white/80">{fmt(day.energy!)}</span>/10
                </div>
                {day.sleepHours !== null && (
                  <div>
                    Slept <span className="text-white/80">{fmt(day.sleepHours)}h</span>
                  </div>
                )}
              </>
            ) : (
              <div>Waiting for energy</div>
            )}
          </div>
        </div>
        <SpoonMeter day={day} />
      </div>

      {/* Crash risk */}
      <AnimatePresence mode="popLayout">
        {day.crash && (
          <motion.div
            key={day.crash.level}
            layout
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={spring}
            className={`rounded-2xl border px-4 py-3.5 ${
              CRASH_COPY[day.crash.level].tone === "warn"
                ? "border-[var(--color-warn)]/25 bg-[var(--color-warn)]/[0.08] shadow-[0_0_40px_-12px_var(--color-warn)]"
                : "border-[var(--color-rest)]/20 bg-[var(--color-rest)]/[0.06]"
            }`}
            role="status"
          >
            <div
              className={`text-[13px] font-medium uppercase tracking-[0.12em] ${
                CRASH_COPY[day.crash.level].tone === "warn" ? "text-[var(--color-warn)]" : "text-[var(--color-rest)]"
              }`}
            >
              {CRASH_COPY[day.crash.level].label}
            </div>
            <div className="mt-1 text-[15px] leading-snug text-white/75">{day.crash.reason}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Day */}
      <div className="flex flex-col gap-5">
        {SLOTS.map((slot) => (
          <div key={slot} className="grid grid-cols-1 gap-2 sm:grid-cols-[88px_minmax(0,1fr)] sm:gap-3">
            <div className="text-[13px] capitalize text-white/35 sm:pt-3">{slot}</div>
            <div className="flex min-h-[50px] min-w-0 flex-col gap-2">
              <AnimatePresence initial={false}>
                {groups[slot].map((item) => (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: 14, scale: 0.97, filter: "blur(6px)" }}
                    animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                    exit={{ opacity: 0, x: 20, filter: "blur(6px)" }}
                    transition={spring}
                  >
                    <Item item={item} />
                  </motion.div>
                ))}
              </AnimatePresence>
              {groups[slot].length === 0 && (
                <div className="h-[50px] rounded-2xl border border-dashed border-white/[0.06] max-sm:h-10" />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
