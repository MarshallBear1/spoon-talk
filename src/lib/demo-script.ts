import type { DayAction } from "./spoons";

/**
 * Scripted playback for demo mode. It drives the exact same reducer as the live
 * ElevenLabs client tools, so the UI animates identically with no keys at all.
 *
 * `say` steps are spoken lines (agent or user); `tool` steps are the client tool
 * calls the agent would make at that moment.
 */
export type DemoStep =
  | { kind: "say"; role: "agent" | "user"; text: string }
  | { kind: "tool"; name: string; action: DayAction }
  | { kind: "pause"; ms: number };

export const DEMO_SCRIPT: DemoStep[] = [
  { kind: "say", role: "agent", text: "Hi, I'm Spoon Talk. Tell me what today looks like, and we'll plan it in spoons." },
  { kind: "say", role: "user", text: "I've got a GP appointment at eleven, I need a shower, and I really want to cook tonight." },
  { kind: "say", role: "agent", text: "Okay. Before we plan, how did you sleep, and where's your energy out of ten?" },
  { kind: "say", role: "user", text: "Patchy. About five hours. Energy's maybe a four." },
  { kind: "tool", name: "set_energy", action: { type: "set_energy", level: 4, sleepHours: 5 } },
  { kind: "say", role: "agent", text: "A four gives us ten spoons today. On five hours' sleep, everything costs a little more." },
  { kind: "tool", name: "add_activity", action: { type: "add_activity", name: "Shower", spoons: 2, when: "morning", note: "sit on a stool" } },
  { kind: "say", role: "agent", text: "Shower first. Two spoons, less if you sit." },
  { kind: "tool", name: "add_activity", action: { type: "add_activity", name: "GP appointment", spoons: 4.5, when: "morning", note: "travel and waiting" } },
  { kind: "say", role: "agent", text: "The GP visit is the big one. Travel, the waiting room, talking. Four and a half." },
  { kind: "tool", name: "suggest_rest", action: { type: "suggest_rest", after: "GP appointment", minutes: 45 } },
  { kind: "say", role: "agent", text: "Then a proper rest. Forty-five minutes lying down, no screens. That gives one back." },
  { kind: "tool", name: "add_activity", action: { type: "add_activity", name: "Cook dinner", spoons: 4, when: "evening", note: "from scratch" } },
  { kind: "say", role: "agent", text: "Cooking from scratch is about four. That leaves you half a spoon." },
  {
    kind: "tool",
    name: "flag_crash_risk",
    action: {
      type: "flag_crash_risk",
      level: "high",
      reason: "Almost the whole budget, on five hours' sleep. A crash often lands 24 to 48 hours later.",
    },
  },
  { kind: "say", role: "agent", text: "Honestly, that's how a crash sneaks up. It often lands a day or two later. Could dinner be one pan?" },
  { kind: "say", role: "user", text: "Yeah. One-pan is fine." },
  { kind: "tool", name: "add_activity", action: { type: "add_activity", name: "Cook dinner", spoons: 2, when: "evening", note: "one pan, seated prep" } },
  { kind: "tool", name: "flag_crash_risk", action: { type: "flag_crash_risk", level: "low", reason: "Two and a half spoons in reserve. Keep tomorrow gentle either way." } },
  { kind: "say", role: "agent", text: "Lovely. One pan, prep sitting down: two spoons. You've got two and a half in reserve." },
  { kind: "pause", ms: 600 },
  { kind: "say", role: "agent", text: "Go gently. I'll be here tomorrow." },
];

/** Roughly how long a line takes to say, so captions and the orb stay in sync. */
export const speakMs = (text: string, role: "agent" | "user") => {
  const words = text.split(/\s+/).length;
  const wps = role === "agent" ? 2.7 : 3.1;
  return Math.max(1400, (words / wps) * 1000);
};
