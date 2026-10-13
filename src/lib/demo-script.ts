import type { DayAction } from "./spoons";

/**
 * Scripted playback for demo mode. It drives the exact same reducer and model as
 * the live ElevenLabs client tools, so the UI animates identically with no keys.
 *
 * The story exercises every model input: short poor sleep, a heavy day two days
 * ago (the PEM lag), a falling barometer, Bayesian activity costs, an over-budget
 * plan with a high crash risk, then a trade-off that brings it back down.
 */
export type DemoStep =
  | { kind: "say"; role: "agent" | "user"; text: string }
  | { kind: "tool"; name: string; action: DayAction }
  | { kind: "pause"; ms: number };

export const DEMO_WEATHER = { pressure: 1003.2, delta24: -9, tempC: 14, place: "London", source: "demo" } as const;

export const DEMO_SCRIPT: DemoStep[] = [
  { kind: "say", role: "agent", text: "Hi, I'm Spoon Talk. Tell me what today looks like, and we'll plan it in spoons." },
  { kind: "say", role: "user", text: "GP appointment at eleven, a shower, and I really want to cook tonight." },
  { kind: "say", role: "agent", text: "Okay. How did you sleep, and where's your energy out of ten?" },
  { kind: "say", role: "user", text: "Badly. About five hours. Energy's maybe a five." },
  { kind: "tool", name: "set_energy", action: { type: "set_energy", level: 5 } },
  { kind: "tool", name: "set_sleep", action: { type: "set_sleep", hours: 5, quality: "poor" } },
  { kind: "say", role: "agent", text: "A five is twelve spoons on a good night. Short, broken sleep takes about one and a half off." },
  { kind: "say", role: "agent", text: "How were the last couple of days?" },
  { kind: "say", role: "user", text: "Yesterday was quiet. Sunday I went to my sister's and properly overdid it." },
  { kind: "tool", name: "log_previous_day", action: { type: "log_previous_day", daysAgo: 1, record: { spent: 7, budget: 9 } } },
  { kind: "tool", name: "log_previous_day", action: { type: "log_previous_day", daysAgo: 2, record: { spent: 15, budget: 11 } } },
  { kind: "tool", name: "open-meteo", action: { type: "set_weather", weather: { ...DEMO_WEATHER } } },
  {
    kind: "say",
    role: "agent",
    text: "Sunday can still land today, so I've kept a spoon back. And pressure's dropped nine hectopascals since yesterday, so I've trimmed a little more. That's eight and a half.",
  },
  { kind: "tool", name: "add_activity", action: { type: "add_activity", name: "Shower", spoons: 2, when: "morning", note: "sit on a stool" } },
  { kind: "say", role: "agent", text: "Shower first. About two spoons, less if you sit." },
  {
    kind: "tool",
    name: "add_activity",
    action: { type: "add_activity", name: "GP appointment", spoons: 4.5, when: "morning", note: "travel and waiting" },
  },
  { kind: "say", role: "agent", text: "The GP visit is the big one. With travel and the waiting room, a bit over four." },
  { kind: "tool", name: "suggest_rest", action: { type: "suggest_rest", after: "GP appointment", minutes: 45 } },
  { kind: "say", role: "agent", text: "Then a proper rest. Forty-five minutes lying down, no screens." },
  { kind: "tool", name: "add_activity", action: { type: "add_activity", name: "Cook dinner", spoons: 4, when: "evening", note: "from scratch" } },
  {
    kind: "tool",
    name: "flag_crash_risk",
    action: { type: "flag_crash_risk", reason: "Over budget on five hours' sleep, two days after a heavy one." },
  },
  { kind: "say", role: "agent", text: "Cooking from scratch is nearly four. That puts you over budget." },
  { kind: "say", role: "agent", text: "Honestly, that's how a crash sneaks up. It often lands a day or two later. Could dinner be one pan?" },
  { kind: "say", role: "user", text: "Yeah. One-pan is fine." },
  {
    kind: "tool",
    name: "add_activity",
    action: { type: "add_activity", name: "Cook dinner", spoons: 2, when: "evening", note: "one pan, seated prep" },
  },
  { kind: "tool", name: "suggest_rest", action: { type: "suggest_rest", after: "Shower", minutes: 30 } },
  {
    kind: "tool",
    name: "flag_crash_risk",
    action: { type: "flag_crash_risk", reason: "Back inside budget, with rest after the shower and the GP." },
  },
  {
    kind: "say",
    role: "agent",
    text: "Lovely. One pan, prep sitting down, and half an hour's rest after your shower. Crash risk is down to about one in four.",
  },
  { kind: "pause", ms: 600 },
  { kind: "say", role: "agent", text: "Go gently. I'll be here tomorrow." },
];

/** Roughly how long a line takes to say, so captions and the orb stay in sync. */
export const speakMs = (text: string, role: "agent" | "user") => {
  const words = text.split(/\s+/).length;
  const wps = role === "agent" ? 2.8 : 3.1;
  return Math.max(1400, (words / wps) * 1000);
};
