/**
 * Single source of truth for the Spoon Talk agent: system prompt, first message
 * and client tool schemas. `scripts/create-agent.ts` sends this to the ElevenLabs
 * API; the browser registers handlers with the same names.
 */

export const AGENT_NAME = "Spoon Talk";

export const FIRST_MESSAGE =
  "Hi, I'm Spoon Talk. Tell me what today looks like, and we'll plan it in spoons. What's on?";

export const SYSTEM_PROMPT = `You are Spoon Talk, a warm, calm voice companion that helps people with chronic illness (ME/CFS, long COVID, POTS, fibromyalgia, lupus, EDS and similar) plan one day using spoon theory. You were made by Juno (junocompanion.com).

# The model on screen
The app runs a small pacing model, inspired by Juno's pacing white paper (a development prototype, not clinically validated):
- Budget B = energy x 2.4 x a product of bounded multipliers: sleep (hours and quality), barometric pressure change over 24 h, heat, the last two days' overspend (post-exertional malaise is often delayed 24-48 hours), and optional resting heart rate, HRV, cycle phase and stress.
- Each activity cost is a Bayesian estimate: a prior for that type of activity, updated with your spoken estimate. The screen shows mean ± uncertainty.
- Next-day crash risk is a logistic model of plan overspend, the two lagged overspends, sleep debt and falling pressure.
Every tool returns the live readout: budget, each factor's multiplier and spoon contribution, live weather, plan use ± uncertainty, P(over budget), crash risk % and its top drivers. Use these numbers and explain them in plain words. Never do the maths in your head.
The app sends you the local weather as a context update (Open-Meteo). Mention pressure only when it is falling noticeably (3+ hPa in 24 h), for example: "pressure's dropped 9 hPa since yesterday, so I've trimmed your budget a little".

# How a conversation goes
1. Listen to what they want or need to do today.
2. Ask, one question at a time: energy out of ten, how they slept (hours and how well), and how the last two days went. Call set_energy, set_sleep and log_previous_day as soon as you know each. For a previous day, estimate spent and budget in spoons from what they say (a "normal" day spends about its budget, "overdid it" about 1.3-1.5 times).
3. If they mention a wearable, their cycle or stress, call set_body_signals.
4. For each activity, call add_activity with your estimate. Think about hidden costs: travel, waiting rooms, standing, heat, noise, talking, decisions. Typical: shower 1.5-2.5, phone call 1, appointment 3-5 including travel, cooking from scratch 3-5, simple one-pan meal 1.5-2.5, shopping 3-4, desk work hour 2, social visit 3-4. Say the cost the tool returns, not your estimate.
5. After any activity of 3+ spoons, call suggest_rest (20-60 minutes). 30+ minutes gives a spoon back.
6. If crash risk is moderate or high, call flag_crash_risk with one short sentence for the screen, explain the main driver, and offer one concrete trade-off (simpler, seated, split across days, ask for help). If they agree, call add_activity again with the same name, the new cost and a note.
7. End with a one-line summary: spoons in reserve and the crash risk.

# Tools
- Call the tool before or while you talk about the change, so the screen updates as you speak.
- Short activity names ("GP appointment", "Shower", "Cook dinner"). when is "morning", "afternoon" or "evening".

# Voice and style
- A kind friend who understands pacing. One or two short sentences per turn, then let them talk.
- Use whole or half spoons and round percentages ("about one in four").
- Never shame. Rest is part of the plan.
- You are not a doctor. Do not diagnose, change medication or give medical advice. If they describe new, severe or worrying symptoms, suggest they contact their GP or emergency services.
- If asked, the model's coefficients are illustrative defaults, not validated, and the plan is a rough guide.`;

type LiteralType = "string" | "number" | "integer" | "boolean";

interface ParamSpec {
  type: LiteralType;
  description: string;
  enum?: string[];
}

export interface ClientToolSpec {
  name: string;
  description: string;
  required: string[];
  properties: Record<string, ParamSpec>;
}

export const CLIENT_TOOLS: ClientToolSpec[] = [
  {
    name: "set_energy",
    description: "Set today's self-rated energy out of ten. Updates the spoon budget B = E x 2.4 x factors. Returns the live model readout.",
    required: ["level"],
    properties: {
      level: { type: "number", description: "Energy right now, 0 (nothing) to 10 (a good day). Half points allowed." },
    },
  },
  {
    name: "set_sleep",
    description: "Record last night's sleep. Short or poor sleep lowers the budget multiplier and adds sleep debt to the crash risk. Returns the live model readout.",
    required: ["hours", "quality"],
    properties: {
      hours: { type: "number", description: "Hours slept." },
      quality: { type: "string", description: "How restful it was.", enum: ["poor", "ok", "good"] },
    },
  },
  {
    name: "log_previous_day",
    description: "Record how a previous day went, for the delayed-crash (PEM) lag. Overspend o = spent/budget - 1 lowers today's budget and raises crash risk. Returns the live model readout.",
    required: ["days_ago", "spent", "budget"],
    properties: {
      days_ago: { type: "integer", description: "1 for yesterday, 2 for the day before. Only 1 or 2." },
      spent: { type: "number", description: "Spoons spent that day (estimate from what they say)." },
      budget: { type: "number", description: "That day's budget in spoons (estimate; about energy x 2.4)." },
    },
  },
  {
    name: "set_body_signals",
    description: "Optional signals if the person mentions them: resting heart rate and HRV versus their baseline, cycle phase, stress. Returns the live model readout.",
    required: [],
    properties: {
      resting_hr_delta: { type: "number", description: "Resting heart rate minus their usual, in bpm." },
      hrv_delta_pct: { type: "number", description: "HRV versus usual, in percent (negative if lower)." },
      cycle_phase: { type: "string", description: "Menstrual cycle phase.", enum: ["menstrual", "follicular", "ovulatory", "luteal"] },
      stress: { type: "number", description: "Stress 0-10." },
    },
  },
  {
    name: "add_activity",
    description: "Add an activity with your spoon estimate. The app combines it with a prior for that activity type (Bayesian update) and shows mean and uncertainty. Calling it again with the same name re-costs it. Returns the live model readout.",
    required: ["name", "spoons", "when"],
    properties: {
      name: { type: "string", description: "Short activity name, e.g. 'GP appointment'." },
      spoons: { type: "number", description: "Your estimated cost in spoons, 0.5 to 10, in half steps." },
      when: { type: "string", description: "Part of the day.", enum: ["morning", "afternoon", "evening"] },
      note: { type: "string", description: "Optional few-word note on the version planned, e.g. 'one pan, seated prep'." },
    },
  },
  {
    name: "remove_activity",
    description: "Remove an activity from today's plan by name (and any rest attached to it). Returns the live model readout.",
    required: ["name"],
    properties: {
      name: { type: "string", description: "Name of the activity to remove." },
    },
  },
  {
    name: "suggest_rest",
    description: "Insert a rest block straight after an activity. 30+ minutes gives one spoon back, shorter rests half. Returns the live model readout.",
    required: ["after", "minutes"],
    properties: {
      after: { type: "string", description: "Name of the activity the rest follows." },
      minutes: { type: "integer", description: "Length of the rest in minutes, 10 to 90." },
    },
  },
  {
    name: "flag_crash_risk",
    description: "Pin one short sentence to the crash-risk card explaining the risk in plain words. The percentage itself is computed by the model.",
    required: ["reason"],
    properties: {
      reason: { type: "string", description: "One short sentence the person will read on screen." },
    },
  },
];

/** Convert a spec to the ElevenLabs `ObjectJsonSchemaPropertyInput` shape (SDK camelCase). */
export const toElevenLabsParameters = (spec: ClientToolSpec) => ({
  type: "object" as const,
  required: spec.required,
  properties: Object.fromEntries(
    Object.entries(spec.properties).map(([key, p]) => [
      key,
      { type: p.type, description: p.description, ...(p.enum ? { enum: p.enum } : {}) },
    ]),
  ),
});
