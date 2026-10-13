/**
 * Day state and reducer. The live ElevenLabs client tools and the scripted demo
 * both dispatch these actions, so the UI behaves identically in both modes.
 * All maths lives in ./model.ts.
 */
import {
  K_DEFAULT,
  budget,
  crashRisk,
  planTotals,
  posterior,
  priorFor,
  topTerms,
  type CyclePhase,
  type DayRecord,
  type ModelInputs,
  type Posterior,
  type SleepQuality,
  type Weather,
} from "./model";

export const SLOTS = ["morning", "afternoon", "evening"] as const;
export type Slot = (typeof SLOTS)[number];

export interface Activity {
  id: string;
  kind: "activity";
  name: string;
  /** The spoken estimate (the observation fed to the Bayesian update). */
  estimate: number;
  cost: Posterior;
  when: Slot;
  note?: string;
}

export interface Rest {
  id: string;
  kind: "rest";
  name: string;
  minutes: number;
  /** Spoons a rest gives back. */
  credit: number;
  when: Slot;
  after?: string;
}

export type PlanItem = Activity | Rest;

export interface Line {
  id: string;
  role: "user" | "agent";
  text: string;
}

export interface DayState extends ModelInputs {
  items: PlanItem[];
  /** The agent's one-line explanation for the crash card. */
  crashNote: string | null;
  lines: Line[];
}

export const initialDay = (weather: Weather | null = null): DayState => ({
  energy: null,
  sleep: null,
  weather,
  history: { d1: null, d2: null },
  body: {},
  k: K_DEFAULT,
  items: [],
  crashNote: null,
  lines: [],
});

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** LLM tool arguments can arrive as strings; coerce defensively. */
export const num = (value: unknown, fallback: number): number => {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : fallback;
};
export const optNum = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const n = num(value, Number.NaN);
  return Number.isFinite(n) ? n : undefined;
};

export const toSlot = (value: unknown): Slot => {
  const v = String(value ?? "").toLowerCase();
  if (v.includes("even") || v.includes("night") || v.includes("dinner")) return "evening";
  if (v.includes("after") || v.includes("lunch") || v.includes("mid")) return "afternoon";
  if (v.includes("morn") || v.includes("breakfast")) return "morning";
  const hour = Number.parseInt(v, 10);
  if (Number.isFinite(hour)) {
    const h = v.includes("pm") && hour < 12 ? hour + 12 : hour;
    if (h >= 17) return "evening";
    if (h >= 12) return "afternoon";
    return "morning";
  }
  return "afternoon";
};

export const toQuality = (value: unknown): SleepQuality => {
  const v = String(value ?? "").toLowerCase();
  if (/poor|bad|broken|patchy|awful|rough/.test(v)) return "poor";
  if (/good|great|deep|solid/.test(v)) return "good";
  return "ok";
};

export const toPhase = (value: unknown): CyclePhase | undefined => {
  const v = String(value ?? "").toLowerCase();
  return (["menstrual", "follicular", "ovulatory", "luteal"] as const).find((p) => v.includes(p.slice(0, 5)));
};

/** Rests of 30+ minutes give a full spoon back, shorter ones half a spoon. */
export const restCredit = (minutes: number) => (minutes >= 30 ? 1 : 0.5);

/* ----------------------------------------------------------------- derived */

export function derive(day: DayState) {
  const B = budget(day);
  const costs = day.items.flatMap((i) => (i.kind === "activity" ? [{ mu: i.cost.mu, sigma: i.cost.sigma }] : []));
  const credits = day.items.reduce((s, i) => (i.kind === "rest" ? s + i.credit : s), 0);
  const totals = planTotals(costs, credits, B.value);
  const risk = crashRisk(day, totals.used, B.value);
  return { budget: B, totals, risk, credits, hasEnergy: day.energy !== null, hasPlan: costs.length > 0 };
}
export type Derived = ReturnType<typeof derive>;

/* ----------------------------------------------------------------- reducer */

const sameName = (a: string, b: string) => {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return x === y || (x.length > 2 && y.length > 2 && (x.includes(y) || y.includes(x)));
};

export const bySlot = (items: PlanItem[]): Record<Slot, PlanItem[]> => {
  const out: Record<Slot, PlanItem[]> = { morning: [], afternoon: [], evening: [] };
  for (const item of items) out[item.when].push(item);
  return out;
};

export type DayAction =
  | { type: "set_energy"; level: number }
  | { type: "set_sleep"; hours: number; quality: SleepQuality }
  | { type: "log_previous_day"; daysAgo: 1 | 2; record: DayRecord }
  | { type: "set_body_signals"; restingHrDelta?: number; hrvDeltaPct?: number; cyclePhase?: CyclePhase; stress?: number }
  | { type: "set_weather"; weather: Weather }
  | { type: "add_activity"; name: string; spoons: number; when: Slot; note?: string }
  | { type: "remove_activity"; name: string }
  | { type: "suggest_rest"; after: string; minutes: number }
  | { type: "flag_crash_risk"; reason: string }
  | { type: "line"; role: Line["role"]; text: string; id?: string }
  | { type: "reset"; weather?: Weather | null };

let counter = 0;
const uid = (prefix: string) => `${prefix}-${(counter++).toString(36)}`;

export function dayReducer(state: DayState, action: DayAction): DayState {
  switch (action.type) {
    case "set_energy":
      return { ...state, energy: clamp(Math.round(action.level * 2) / 2, 0, 10) };

    case "set_sleep":
      return { ...state, sleep: { hours: clamp(action.hours, 0, 16), quality: action.quality } };

    case "log_previous_day": {
      const record = { spent: clamp(action.record.spent, 0, 60), budget: clamp(action.record.budget, 0.5, 60) };
      return { ...state, history: { ...state.history, [action.daysAgo === 1 ? "d1" : "d2"]: record } };
    }

    case "set_body_signals": {
      const { restingHrDelta, hrvDeltaPct, cyclePhase, stress } = action;
      const clean = Object.fromEntries(
        Object.entries({ restingHrDelta, hrvDeltaPct, cyclePhase, stress }).filter(([, v]) => v !== undefined),
      );
      return { ...state, body: { ...state.body, ...clean } };
    }

    case "set_weather":
      return { ...state, weather: action.weather };

    case "add_activity": {
      const estimate = clamp(Math.round(action.spoons * 2) / 2, 0.5, 10);
      const name = action.name.trim() || "Activity";
      const cost = posterior(priorFor(`${name} ${action.note ?? ""}`), [estimate]);
      const existing = state.items.find((i) => i.kind === "activity" && sameName(i.name, name));
      if (existing) {
        // Upsert: re-costing a simpler version replaces the observation and re-picks the prior.
        return {
          ...state,
          items: state.items.map((i) =>
            i.id === existing.id
              ? { ...i, name, estimate, cost, when: action.when, note: action.note ?? (i as Activity).note }
              : i,
          ),
        };
      }
      const item: Activity = { id: uid("a"), kind: "activity", name, estimate, cost, when: action.when, note: action.note };
      return { ...state, items: [...state.items, item] };
    }

    case "remove_activity":
      return {
        ...state,
        items: state.items.filter(
          (i) => !sameName(i.name, action.name) && !(i.kind === "rest" && i.after && sameName(i.after, action.name)),
        ),
      };

    case "suggest_rest": {
      const minutes = clamp(Math.round(action.minutes), 5, 240);
      const idx = state.items.findIndex((i) => i.kind === "activity" && sameName(i.name, action.after));
      const anchor = idx >= 0 ? state.items[idx] : undefined;
      const rest: Rest = {
        id: uid("r"),
        kind: "rest",
        name: "Rest",
        minutes,
        credit: restCredit(minutes),
        when: anchor?.when ?? toSlot(action.after),
        after: anchor?.name ?? action.after,
      };
      const items = [...state.items];
      if (idx >= 0) items.splice(idx + 1, 0, rest);
      else items.push(rest);
      return { ...state, items };
    }

    case "flag_crash_risk":
      return { ...state, crashNote: action.reason.trim() || null };

    case "line": {
      const last = state.lines[state.lines.length - 1];
      if (action.id && last?.id === action.id) {
        return { ...state, lines: [...state.lines.slice(0, -1), { ...last, text: action.text }] };
      }
      return {
        ...state,
        lines: [...state.lines.slice(-40), { id: action.id ?? uid("l"), role: action.role, text: action.text }],
      };
    }

    case "reset":
      return initialDay(action.weather === undefined ? state.weather : action.weather);
  }
}

/* ------------------------------------------------- what the agent is told */

const s1 = (x: number) => x.toFixed(1).replace(/\.0$/, "");

/** Compact model readout returned by every client tool, so the agent speaks real numbers and reasons. */
export function describe(day: DayState): string {
  const d = derive(day);
  const parts: string[] = [];
  if (!d.hasEnergy) parts.push("Energy not set yet (call set_energy).");
  else {
    const factors = d.budget.factors
      .map((f) => `${f.label.toLowerCase()} x${f.m.toFixed(2)} (${f.reading}, ${f.spoons >= 0 ? "+" : ""}${s1(f.spoons)} spoons)`)
      .join(", ");
    parts.push(`Budget ${s1(d.budget.value)} spoons = energy ${s1(day.energy!)} x k ${day.k}${factors ? ` x ${factors}` : ""}.`);
  }
  if (day.weather) {
    parts.push(
      `Weather (${day.weather.source}, ${day.weather.place}): ${Math.round(day.weather.pressure)} hPa, ${s1(day.weather.delta24)} hPa in 24 h, ${Math.round(day.weather.tempC)}C.`,
    );
  }
  if (d.hasPlan || d.credits > 0) {
    parts.push(
      `Plan uses ${s1(d.totals.used)} +/- ${s1(d.totals.sigma)} spoons, ${
        d.totals.left >= 0 ? `${s1(d.totals.left)} left` : `${s1(-d.totals.left)} OVER (borrowing from tomorrow)`
      }; P(over budget) ${Math.round(d.totals.pOver * 100)}%.`,
    );
    const top = topTerms(d.risk).map((t) => t.label.toLowerCase());
    parts.push(
      `Next-day crash risk ${Math.round(d.risk.p * 100)}% (${d.risk.level})${top.length ? `, driven by ${top.join(" and ")}` : ""}.`,
    );
    const plan = day.items
      .map((i) =>
        i.kind === "activity"
          ? `${i.name} ${s1(i.cost.mu)}+/-${s1(i.cost.sigma)} (${i.when})`
          : `rest ${i.minutes}m after ${i.after} (+${i.credit})`,
      )
      .join("; ");
    parts.push(`Plan: ${plan}.`);
  }
  return parts.join(" ");
}
