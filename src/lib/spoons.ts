/**
 * The spoon model behind Spoon Talk.
 *
 * Inspired by Juno's technical white paper "Personalized pacing with Juno"
 * (https://junocompanion.com/juno_pacing_whitepaper.pdf). That paper describes a
 * development prototype; nothing here is clinically validated and none of it is
 * medical advice. We only borrow its simplest starting rule:
 *
 *   daily budget = energy rating (0-10) x k, with k = 2.4 by default
 *
 * Everything is pure and serialisable so the live agent (ElevenLabs client tools)
 * and the scripted demo drive exactly the same reducer.
 */

export const SPOONS_PER_POINT = 2.4;
export const ENERGY_MIN = 0;
export const ENERGY_MAX = 10;
export const COST_MAX = 10;

export const SLOTS = ["morning", "afternoon", "evening"] as const;
export type Slot = (typeof SLOTS)[number];

export type CrashLevel = "low" | "moderate" | "high";

export interface Activity {
  id: string;
  kind: "activity";
  name: string;
  spoons: number;
  when: Slot;
  note?: string;
}

export interface Rest {
  id: string;
  kind: "rest";
  name: string;
  minutes: number;
  /** Spoons a rest gives back (never scaled). */
  credit: number;
  when: Slot;
  after?: string;
}

export type PlanItem = Activity | Rest;

export interface CrashRisk {
  level: CrashLevel;
  reason: string;
}

export interface Line {
  id: string;
  role: "user" | "agent";
  text: string;
}

export interface DayState {
  energy: number | null;
  sleepHours: number | null;
  k: number;
  items: PlanItem[];
  crash: CrashRisk | null;
  lines: Line[];
}

export const initialDay = (k = SPOONS_PER_POINT): DayState => ({
  energy: null,
  sleepHours: null,
  k,
  items: [],
  crash: null,
  lines: [],
});

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const toHalf = (n: number) => Math.round(n * 2) / 2;

/** LLM tool arguments can arrive as strings; coerce defensively. */
export const num = (value: unknown, fallback: number): number => {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : fallback;
};

export const toSlot = (value: unknown): Slot => {
  const v = String(value ?? "").toLowerCase();
  if (v.includes("even") || v.includes("night") || v.includes("dinner")) return "evening";
  if (v.includes("after") || v.includes("lunch") || v.includes("mid")) return "afternoon";
  if (v.includes("morn") || v.includes("am") || v.includes("breakfast")) return "morning";
  const hour = Number.parseInt(v, 10);
  if (Number.isFinite(hour)) {
    const h = v.includes("pm") && hour < 12 ? hour + 12 : hour;
    if (h >= 17) return "evening";
    if (h >= 12) return "afternoon";
    return "morning";
  }
  return "afternoon";
};

/** Rests of 30+ minutes give a full spoon back, shorter ones half a spoon. */
export const restCredit = (minutes: number) => (minutes >= 30 ? 1 : 0.5);

export const budgetFor = (energy: number, k = SPOONS_PER_POINT) =>
  Math.round(clamp(energy, ENERGY_MIN, ENERGY_MAX) * k);

export interface Totals {
  budget: number;
  spent: number;
  credits: number;
  used: number;
  left: number;
  /** Spoons borrowed from tomorrow (0 when within budget). */
  borrowed: number;
}

export const totals = (day: DayState): Totals => {
  const budget = day.energy === null ? 0 : budgetFor(day.energy, day.k);
  let spent = 0;
  let credits = 0;
  for (const item of day.items) {
    if (item.kind === "activity") spent += item.spoons;
    else credits += item.credit;
  }
  const used = Math.max(0, spent - credits);
  const left = budget - used;
  return { budget, spent, credits, used, left, borrowed: Math.max(0, -left) };
};

const sameName = (a: string, b: string) => {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return x === y || (x.length > 2 && y.length > 2 && (x.includes(y) || y.includes(x)));
};

/** Items grouped into slots, preserving insertion order and rest placement. */
export const bySlot = (items: PlanItem[]): Record<Slot, PlanItem[]> => {
  const out: Record<Slot, PlanItem[]> = { morning: [], afternoon: [], evening: [] };
  for (const item of items) out[item.when].push(item);
  return out;
};

export type DayAction =
  | { type: "set_energy"; level: number; sleepHours?: number | null }
  | { type: "add_activity"; name: string; spoons: number; when: Slot; note?: string }
  | { type: "remove_activity"; name: string }
  | { type: "suggest_rest"; after: string; minutes: number }
  | { type: "flag_crash_risk"; level: CrashLevel; reason: string }
  | { type: "line"; role: Line["role"]; text: string; id?: string }
  | { type: "reset" };

let counter = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function dayReducer(state: DayState, action: DayAction): DayState {
  switch (action.type) {
    case "set_energy":
      return {
        ...state,
        energy: clamp(toHalf(action.level), ENERGY_MIN, ENERGY_MAX),
        sleepHours: action.sleepHours ?? state.sleepHours,
      };

    case "add_activity": {
      const spoons = clamp(toHalf(action.spoons), 0.5, COST_MAX);
      const existing = state.items.find((i) => i.kind === "activity" && sameName(i.name, action.name));
      if (existing) {
        // Upsert: the agent re-costs an activity by adding it again under the same name.
        return {
          ...state,
          items: state.items.map((i) =>
            i.id === existing.id
              ? { ...i, name: action.name, spoons, when: action.when, note: action.note ?? (i as Activity).note }
              : i,
          ),
        };
      }
      const item: Activity = {
        id: uid("a"),
        kind: "activity",
        name: action.name.trim() || "Activity",
        spoons,
        when: action.when,
        note: action.note,
      };
      return { ...state, items: [...state.items, item] };
    }

    case "remove_activity":
      return {
        ...state,
        items: state.items.filter((i) => !sameName(i.name, action.name) && !(i.kind === "rest" && i.after && sameName(i.after, action.name))),
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
      return { ...state, crash: { level: action.level, reason: action.reason } };

    case "line": {
      const last = state.lines[state.lines.length - 1];
      if (action.id && last?.id === action.id) {
        return { ...state, lines: [...state.lines.slice(0, -1), { ...last, text: action.text }] };
      }
      const line: Line = { id: action.id ?? uid("l"), role: action.role, text: action.text };
      return { ...state, lines: [...state.lines.slice(-30), line] };
    }

    case "reset":
      return initialDay(state.k);
  }
}

/** A short status the client tools return to the agent, so it always speaks real numbers. */
export const describe = (day: DayState): string => {
  const t = totals(day);
  if (day.energy === null) return "Energy not set yet. Call set_energy first.";
  const plan = day.items
    .map((i) => (i.kind === "activity" ? `${i.name} (${i.spoons}, ${i.when})` : `rest ${i.minutes}m after ${i.after} (+${i.credit})`))
    .join("; ");
  const state =
    t.left < 0
      ? `OVER budget by ${t.borrowed} spoons (borrowing from tomorrow)`
      : `${t.left} spoons left`;
  return `Budget ${t.budget} spoons (energy ${day.energy} x ${day.k}). Used ${t.used}. ${state}. Plan: ${plan || "empty"}.`;
};
