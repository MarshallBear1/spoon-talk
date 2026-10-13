"use client";

import { AnimatePresence, motion } from "motion/react";
import { useId } from "react";
import { BorderBeam } from "@/components/ui/border-beam";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { NumberTicker } from "@/components/ui/number-ticker";
import { cn } from "@/lib/utils";
import { W, topTerms, type Factor, type Posterior } from "@/lib/model";
import { SLOTS, bySlot, type DayState, type Derived, type PlanItem } from "@/lib/spoons";
import { Spoon } from "./Spoon";
import { Tex } from "./Tex";

const fmt = (n: number, dp = 1) => n.toFixed(dp).replace(/\.0$/, "");
const spring = { type: "spring", stiffness: 380, damping: 32, mass: 0.8 } as const;

/* ------------------------------------------------------------ spoon meter */

function SpoonMeter({ d }: { d: Derived }) {
  const B = d.budget.value;
  const slots = Math.max(Math.ceil(B), 10);
  const left = Math.max(0, d.totals.left);
  const borrowed = Math.ceil(Math.max(0, -d.totals.left) * 2) / 2;

  return (
    <div className="flex flex-wrap items-end gap-x-[5px] gap-y-2" aria-hidden="true">
      {Array.from({ length: slots }, (_, i) => {
        const capacity = d.hasEnergy ? Math.max(0, Math.min(1, B - i)) : 0;
        const fill = Math.max(0, Math.min(capacity, left - i));
        return (
          <motion.div
            key={i}
            initial={false}
            animate={{ opacity: capacity > 0 ? 1 : 0.16, y: fill > 0 ? 0 : 3, scale: fill > 0 ? 1 : 0.94 }}
            transition={{ ...spring, delay: capacity > 0 ? i * 0.03 : 0 }}
          >
            <Spoon
              fill={capacity > 0 ? fill / capacity : 0}
              capacity={capacity > 0 ? capacity : 1}
              tone={fill > 0 ? "full" : "used"}
              className="h-9 w-[14px] sm:h-11 sm:w-[17px]"
            />
          </motion.div>
        );
      })}
      <AnimatePresence>
        {Array.from({ length: Math.ceil(borrowed) }, (_, i) => (
          <motion.div
            key={`b${i}`}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ ...spring, delay: i * 0.05 }}
          >
            <Spoon tone="borrowed" className="h-9 w-[14px] sm:h-11 sm:w-[17px]" />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Mean plan use with a ±σ band against the budget line. */
function UncertaintyBar({ d }: { d: Derived }) {
  const B = d.budget.value;
  const { used, sigma, pOver } = d.totals;
  const max = Math.max(B, used + 2 * sigma, 1) * 1.08;
  const pct = (x: number) => `${Math.max(0, Math.min(100, (x / max) * 100))}%`;
  const over = used > B;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between font-mono text-[11px] text-white/45">
        <span>
          plan {fmt(used)} <span className="text-white/30">± {fmt(sigma)}</span>
        </span>
        <span>
          P(over) <span className={over ? "text-warn" : "text-white/70"}>{Math.round(pOver * 100)}%</span>
        </span>
      </div>
      <div className="relative h-1.5 rounded-full bg-white/[0.06]">
        <motion.div
          className="absolute inset-y-0 rounded-full bg-white/10"
          initial={false}
          animate={{ left: pct(used - sigma), width: `calc(${pct(used + sigma)} - ${pct(used - sigma)})` }}
          transition={spring}
        />
        <motion.div
          className={cn("absolute inset-y-0 left-0 rounded-full", over ? "bg-warn" : "bg-gradient-to-r from-violet-300/80 to-rest")}
          initial={false}
          animate={{ width: pct(used) }}
          transition={spring}
        />
        <div className="absolute -top-1 -bottom-1 w-px bg-white/60" style={{ left: pct(B) }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ factor chips */

const FACTOR_COPY: Record<Factor["id"], string> = {
  sleep: "Short or broken sleep shrinks the day. Neutral at 7.5 hours.",
  pressure: "Rapid pressure drops are commonly reported to worsen pain and fatigue. Only falls count.",
  heat: "Heat intolerance is common, especially with POTS. Above 24°C costs more.",
  pem: "Post-exertional malaise is often delayed 24–48 h, so the last two days count. The 2-day lag weighs more.",
  restingHr: "A resting heart rate above your baseline often signals strain.",
  hrv: "HRV below your baseline often signals poorer recovery.",
  cycle: "Many people report lower energy around menstruation and in the late luteal phase.",
  stress: "Stress spends spoons too.",
};

const SOURCE_LABEL: Record<Factor["source"], string> = {
  you: "from you",
  live: "live · Open-Meteo",
  fallback: "live · Open-Meteo (London)",
  demo: "demo values",
  wearable: "from your wearable",
};

function HistoryBars({ day, B }: { day: DayState; B: number }) {
  const rows = [
    { label: "2 days ago", rec: day.history.d2 },
    { label: "Yesterday", rec: day.history.d1 },
  ];
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {rows.map(({ label, rec }) => {
        const ratio = rec ? rec.spent / rec.budget : 0;
        return (
          <div key={label} className="grid grid-cols-[72px_1fr_40px] items-center gap-2 font-mono text-[11px] text-white/50">
            <span>{label}</span>
            <div className="relative h-1.5 rounded-full bg-white/[0.06]">
              <div
                className={cn("absolute inset-y-0 left-0 rounded-full", ratio > 1 ? "bg-warn" : "bg-white/40")}
                style={{ width: `${Math.min(100, (ratio / 1.6) * 100)}%` }}
              />
              <div className="absolute -top-0.5 -bottom-0.5 w-px bg-white/50" style={{ left: `${100 / 1.6}%` }} />
            </div>
            <span className="text-right">{rec ? `${Math.round(ratio * 100)}%` : "–"}</span>
          </div>
        );
      })}
      <div className="font-mono text-[10px] text-white/30">spent / budget · today B = {fmt(B)}</div>
    </div>
  );
}

function FactorChip({ f, day, B }: { f: Factor; day: DayState; B: number }) {
  const live = f.source === "live" || f.source === "fallback";
  return (
    <HoverCard openDelay={80} closeDelay={60}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="group inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] py-1.5 pr-3 pl-2.5 text-[12px] text-white/70 transition hover:border-white/20 hover:bg-white/[0.06]"
        >
          <span className={cn("relative flex size-1.5", live ? "" : "opacity-60")}>
            {live && <span className="absolute inset-0 animate-ping rounded-full bg-rest/60 [animation-duration:2.4s]" />}
            <span className={cn("relative size-1.5 rounded-full", live ? "bg-rest" : f.source === "demo" ? "bg-violet-300" : "bg-white/60")} />
          </span>
          <span className="text-white/85">{f.label}</span>
          <span className="text-white/40">{f.reading}</span>
          <span className="font-mono text-white/55">×{f.m.toFixed(2)}</span>
          <span className={cn("font-mono", f.spoons < -0.05 ? "text-warn/90" : "text-white/40")}>
            {f.spoons < 0 ? "−" : "+"}
            {fmt(Math.abs(f.spoons))}
          </span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="w-[min(92vw,360px)] border-white/10 bg-popover/95 p-4 backdrop-blur-xl" sideOffset={8}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-white">{f.label}</span>
          <span className="font-mono text-[11px] text-white/40">{SOURCE_LABEL[f.source]}</span>
        </div>
        <p className="mt-1 text-[13px] leading-snug text-white/55">{FACTOR_COPY[f.id]}</p>
        <div className="mt-3 rounded-lg bg-white/[0.03] px-3 py-2 text-white/85">
          <Tex block>{f.tex}</Tex>
          <Tex block>{f.texValues}</Tex>
        </div>
        {f.id === "pem" && <HistoryBars day={day} B={B} />}
        <p className="mt-3 font-mono text-[11px] text-white/40">
          contribution {f.spoons < 0 ? "−" : "+"}
          {fmt(Math.abs(f.spoons), 2)} spoons (log-share)
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}

function Factors({ day, d }: { day: DayState; d: Derived }) {
  return (
    <div className="flex flex-wrap gap-2">
      <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.02] px-3 py-1.5 font-mono text-[12px] text-white/55">
        {d.hasEnergy ? (
          <>
            E·k = {fmt(day.energy!)} × {day.k} = <span className="text-white/85">{fmt(d.budget.base)}</span>
          </>
        ) : (
          <>E·k = ? × {day.k}</>
        )}
      </span>
      <AnimatePresence initial={false}>
        {d.budget.factors.map((f, i) => (
          <motion.div
            key={f.id}
            layout
            initial={{ opacity: 0, scale: 0.9, filter: "blur(4px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ ...spring, delay: i * 0.06 }}
          >
            <FactorChip f={f} day={day} B={d.budget.value} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------- crash card */

function CrashCard({ day, d }: { day: DayState; d: Derived }) {
  const { risk } = d;
  const warn = risk.level !== "low";
  const top = topTerms(risk);
  const active = risk.terms.filter((t) => t.x > 0).map((t) => String.raw`${t.w}\cdot${t.x.toFixed(2)}`);
  const zTex = String.raw`p=\sigma\Big(${[String(W.w0), ...active].join("+").replace("+-", "-")}\Big)=${(risk.p * 100).toFixed(0)}\%`;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring}
      className={cn(
        "relative overflow-hidden rounded-2xl border px-4 py-4 transition-colors duration-700",
        warn ? "border-warn/25 bg-warn/[0.07]" : "border-rest/20 bg-rest/[0.05]",
      )}
      role="status"
    >
      {warn && <BorderBeam size={120} duration={7} colorFrom="#f6a76b" colorTo="#f49aa8" borderWidth={1.5} />}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className={cn("text-[12px] font-medium tracking-[0.12em] uppercase", warn ? "text-warn" : "text-rest")}>
            {risk.level === "high" ? "Crash risk tomorrow" : risk.level === "moderate" ? "Watch tomorrow" : "Crash risk eased"}
          </div>
          <AnimatePresence mode="wait">
            {day.crashNote && (
              <motion.p
                key={day.crashNote}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-1 text-[14px] leading-snug text-white/75"
              >
                {day.crashNote}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
        <HoverCard openDelay={80}>
          <HoverCardTrigger asChild>
            <button type="button" className="shrink-0 text-right" aria-label={`Crash risk ${Math.round(risk.p * 100)} percent`}>
              <span className={cn("text-4xl font-semibold tracking-tight tabular-nums", warn ? "text-warn" : "text-rest")}>
                <NumberTicker value={Math.round(risk.p * 100)} className={warn ? "text-warn" : "text-rest"} />
                <span className="text-xl">%</span>
              </span>
            </button>
          </HoverCardTrigger>
          <HoverCardContent className="w-[min(92vw,420px)] border-white/10 bg-popover/95 p-4 backdrop-blur-xl" align="end">
            <div className="text-sm font-medium">Logistic crash-risk model</div>
            <div className="mt-2 rounded-lg bg-white/[0.03] px-3 py-2">
              <Tex block>{zTex}</Tex>
            </div>
            <ul className="mt-2 space-y-1 font-mono text-[11px] text-white/55">
              {risk.terms.map((t) => (
                <li key={t.id} className="flex justify-between gap-3">
                  <span>{t.label}</span>
                  <span>
                    {t.w} × {t.x.toFixed(2)} = {t.contribution.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          </HoverCardContent>
        </HoverCard>
      </div>
      {top.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {top.map((t) => (
            <span key={t.id} className="rounded-full bg-white/[0.05] px-2.5 py-1 font-mono text-[11px] text-white/55">
              {t.label} <span className="text-white/35">+{t.contribution.toFixed(1)}</span>
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
}

/* ---------------------------------------------------------------- items */

/** A Normal curve on the prior's ±3σ range; the prior is drawn faint behind the posterior. */
function Bell({ post, width = 64, height = 18, showPrior = false }: { post: Posterior; width?: number; height?: number; showPrior?: boolean }) {
  const gid = `bell${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const span = showPrior ? 3 * post.prior.sigma : 3.2 * post.sigma;
  const lo = (showPrior ? post.prior.mu : post.mu) - span;
  const hi = (showPrior ? post.prior.mu : post.mu) + span;
  const pdf = (x: number, mu: number, s: number) => Math.exp(-((x - mu) ** 2) / (2 * s * s)) / s;
  const peak = 1 / post.sigma;
  const path = (mu: number, sigma: number) => {
    const pts: string[] = [];
    for (let i = 0; i <= 64; i++) {
      const x = lo + ((hi - lo) * i) / 64;
      pts.push(`${((i / 64) * width).toFixed(1)},${(height - (pdf(x, mu, sigma) / peak) * (height - 1)).toFixed(1)}`);
    }
    return `M0,${height} L${pts.join(" L")} L${width},${height} Z`;
  };
  const mx = ((post.mu - lo) / (hi - lo)) * width;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="overflow-visible">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#b4a9ff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#73e0cc" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      {showPrior && <path d={path(post.prior.mu, post.prior.sigma)} fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" />}
      <path d={path(post.mu, post.sigma)} fill={`url(#${gid})`} />
      <line x1={mx} x2={mx} y1={0} y2={height} stroke="rgba(255,255,255,0.5)" strokeWidth={1} />
    </svg>
  );
}

function Item({ item }: { item: PlanItem }) {
  if (item.kind === "rest") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-rest/20 bg-rest/[0.06] px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="relative flex size-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-rest/50 [animation-duration:2.4s]" />
            <span className="relative size-2 rounded-full bg-rest" />
          </span>
          <span className="text-[14px] text-rest">Rest · {item.minutes} min</span>
        </div>
        <span className="font-mono text-sm text-rest tabular-nums">+{fmt(item.credit)}</span>
      </div>
    );
  }
  const { cost } = item;
  return (
    <HoverCard openDelay={120}>
      <HoverCardTrigger asChild>
        <div className="flex cursor-default items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-4 py-3 transition hover:border-white/15">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-medium text-white/90">{item.name}</div>
            {item.note && <div className="truncate text-[12.5px] text-white/40">{item.note}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden sm:block">
              <Bell post={cost} />
            </span>
            <span className="text-right font-mono tabular-nums">
              <span className="text-[15px] text-white/85">{cost.mu.toFixed(1)}</span>
              <span className="ml-1 text-[11px] text-white/35">±{cost.sigma.toFixed(1)}</span>
            </span>
          </div>
        </div>
      </HoverCardTrigger>
      <HoverCardContent className="w-[min(92vw,360px)] border-white/10 bg-popover/95 p-4 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{item.name}</span>
          <span className="font-mono text-[11px] text-white/40">prior: {cost.prior.type}</span>
        </div>
        <div className="mt-3 flex justify-center">
          <Bell post={cost} width={300} height={56} showPrior />
        </div>
        <div className="mt-2 rounded-lg bg-white/[0.03] px-3 py-2">
          <Tex block>
            {String.raw`\mu=\frac{\mu_0/\sigma_0^2+x/\sigma_x^2}{1/\sigma_0^2+1/\sigma_x^2}=\frac{${cost.prior.mu}/${cost.prior.sigma}^2+${cost.observations[0]}/0.8^2}{1/${cost.prior.sigma}^2+1/0.8^2}=${cost.mu.toFixed(2)}`}
          </Tex>
          <Tex block>{String.raw`\sigma=\big(1/\sigma_0^2+1/\sigma_x^2\big)^{-1/2}=${cost.sigma.toFixed(2)}`}</Tex>
        </div>
        <p className="mt-2 text-[12px] leading-snug text-white/45">
          Prior N({cost.prior.mu}, {cost.prior.sigma}²) for {cost.prior.type}, updated with the spoken estimate x = {cost.observations[0]}.
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}

/* ------------------------------------------------------------------ panel */

export function DayPlan({ day, d }: { day: DayState; d: Derived }) {
  const groups = bySlot(day.items);
  const over = d.totals.left < 0;
  const shown = over ? -d.totals.left : d.totals.left;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-[12px] tracking-[0.14em] text-white/40 uppercase">
            {over ? "Borrowed from tomorrow" : "Spoons left"}
          </div>
          <div className="mt-1.5 flex items-baseline gap-3">
            {d.hasEnergy ? (
              <NumberTicker
                value={Math.round(shown * 10) / 10}
                decimalPlaces={1}
                className={cn("text-6xl font-semibold tracking-[-0.04em] sm:text-7xl", over ? "text-warn" : "text-white")}
              />
            ) : (
              <span className="text-6xl font-semibold tracking-[-0.04em] text-white/20 sm:text-7xl">–</span>
            )}
            {d.hasEnergy && <span className="text-white/40">of {fmt(d.budget.value)}</span>}
          </div>
        </div>
        <div className="hidden text-right font-mono text-[11px] leading-5 text-white/35 sm:block">
          <Tex>{String.raw`B=E\cdot k\cdot\textstyle\prod_i m_i`}</Tex>
          {d.hasEnergy && <div className="text-white/55">= {d.budget.exact.toFixed(2)}</div>}
        </div>
      </div>

      <SpoonMeter d={d} />
      {d.hasPlan && <UncertaintyBar d={d} />}
      <Factors day={day} d={d} />

      <AnimatePresence>{d.hasPlan && <CrashCard day={day} d={d} />}</AnimatePresence>

      <div className="flex flex-col gap-4">
        {SLOTS.map((slot) => (
          <div key={slot} className="grid grid-cols-1 gap-2 sm:grid-cols-[88px_minmax(0,1fr)] sm:gap-3">
            <div className="text-[12px] text-white/35 capitalize sm:pt-3.5">{slot}</div>
            <div className="flex min-h-[48px] min-w-0 flex-col gap-2">
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
              {groups[slot].length === 0 && <div className="h-12 rounded-2xl border border-dashed border-white/[0.06] max-sm:h-10" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

