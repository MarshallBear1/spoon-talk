/**
 * The Spoon Talk pacing model.
 *
 * Inspired by Juno's technical white paper "Personalized pacing with Juno"
 * (https://junocompanion.com/juno_pacing_whitepaper.pdf), which describes a
 * DEVELOPMENT PROTOTYPE. Nothing here is clinically validated. Every coefficient
 * below is an illustrative default chosen to behave sensibly, not a fitted or
 * published value. This is a planning aid, not medical advice.
 *
 * Three parts, all pure functions:
 *
 *  1. Budget      B = E · k · Π mᵢ          (bounded multipliers per factor)
 *  2. Costs       cⱼ ~ N(μⱼ, σⱼ²)            (conjugate Normal update per activity)
 *  3. Crash risk  p = σ(w₀ + Σ wᵢ xᵢ)         (logistic, with per-term attribution)
 */

/* ------------------------------------------------------------------ helpers */

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
export const round = (x: number, dp = 2) => Math.round(x * 10 ** dp) / 10 ** dp;

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 via erf), |error| < 1.5e-7. */
export const normalCdf = (z: number) => {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
};

/* ------------------------------------------------------------------- inputs */

export type SleepQuality = "poor" | "ok" | "good";
export type CyclePhase = "menstrual" | "follicular" | "ovulatory" | "luteal";

export interface DayRecord {
  /** Spoons actually spent that day. */
  spent: number;
  /** That day's budget. */
  budget: number;
}

export interface Weather {
  /** Surface pressure now, hPa. */
  pressure: number;
  /** Pressure now minus 24 h ago, hPa (negative = falling). */
  delta24: number;
  /** Air temperature, °C. */
  tempC: number;
  place: string;
  source: "live" | "fallback" | "demo";
}

export interface ModelInputs {
  /** Self-rated energy 0–10. */
  energy: number | null;
  sleep: { hours: number; quality: SleepQuality } | null;
  weather: Weather | null;
  /** Yesterday (lag 1) and the day before (lag 2). */
  history: { d1: DayRecord | null; d2: DayRecord | null };
  body: {
    /** Resting heart rate minus personal baseline, bpm. */
    restingHrDelta?: number;
    /** HRV vs baseline, percent (negative = lower than usual). */
    hrvDeltaPct?: number;
    cyclePhase?: CyclePhase;
    /** Self-rated stress 0–10. */
    stress?: number;
  };
  /** Spoons per energy point. */
  k: number;
}

/* -------------------------------------------------------- 1. budget factors */

export const K_DEFAULT = 2.4;
export const K_MIN = 1.2;
export const K_MAX = 4.0;

/** Illustrative coefficients. Not fitted, not validated. */
export const COEF = {
  sleep: { centre: 7.5, slope: 0.04, quality: { poor: -0.04, ok: 0, good: 0.02 }, lo: 0.6, hi: 1.1 },
  pressure: { alpha: 0.06, lo: 0.85 },
  heat: { threshold: 24, gamma: 0.12, lo: 0.85 },
  pem: { beta1: 0.2, beta2: 0.3, lo: 0.6 },
  restingHr: { perBpm: 0.012, lo: 0.85 },
  hrv: { perPct: 0.003, lo: 0.85 },
  cycle: { menstrual: 0.93, follicular: 1, ovulatory: 1, luteal: 0.97 } as Record<CyclePhase, number>,
  stress: { threshold: 5, perPoint: 0.025, lo: 0.85 },
} as const;

export type FactorId = "sleep" | "pressure" | "heat" | "pem" | "restingHr" | "hrv" | "cycle" | "stress";

export interface Factor {
  id: FactorId;
  label: string;
  /** Human reading of the input, e.g. "5 h · poor". */
  reading: string;
  /** Bounded multiplier mᵢ. */
  m: number;
  /** Signed contribution to the budget in spoons (log-share attribution, sums exactly). */
  spoons: number;
  /** KaTeX source for this factor's formula. */
  tex: string;
  /** KaTeX source with today's numbers substituted. */
  texValues: string;
  source: "you" | "live" | "demo" | "fallback" | "wearable";
}

/** o_t = max(0, S_t / B_t − 1): how far a past day overshot its own budget. */
export const overshoot = (d: DayRecord | null) => (d && d.budget > 0 ? Math.max(0, d.spent / d.budget - 1) : 0);

export const sleepMultiplier = (hours: number, quality: SleepQuality) => {
  const c = COEF.sleep;
  return clamp(1 + c.slope * (hours - c.centre) + c.quality[quality], c.lo, c.hi);
};
export const pressureMultiplier = (delta24: number) =>
  clamp(1 - (COEF.pressure.alpha * Math.max(0, -delta24)) / 10, COEF.pressure.lo, 1);
export const heatMultiplier = (tempC: number) =>
  clamp(1 - (COEF.heat.gamma * Math.max(0, tempC - COEF.heat.threshold)) / 10, COEF.heat.lo, 1);
export const pemMultiplier = (o1: number, o2: number) =>
  clamp(1 - COEF.pem.beta1 * o1 - COEF.pem.beta2 * o2, COEF.pem.lo, 1);
export const restingHrMultiplier = (delta: number) =>
  clamp(1 - COEF.restingHr.perBpm * Math.max(0, delta), COEF.restingHr.lo, 1);
export const hrvMultiplier = (deltaPct: number) =>
  clamp(1 - COEF.hrv.perPct * Math.max(0, -deltaPct), COEF.hrv.lo, 1);
export const stressMultiplier = (stress: number) =>
  clamp(1 - COEF.stress.perPoint * Math.max(0, stress - COEF.stress.threshold), COEF.stress.lo, 1);

const f2 = (x: number) => x.toFixed(2);
const f1 = (x: number) => x.toFixed(1);
const signed = (x: number, dp = 1) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(dp)}`;

type RawFactor = Omit<Factor, "spoons">;

export function rawFactors(inp: ModelInputs): RawFactor[] {
  const out: RawFactor[] = [];
  if (inp.sleep) {
    const { hours, quality } = inp.sleep;
    const q = COEF.sleep.quality[quality];
    out.push({
      id: "sleep",
      label: "Sleep",
      reading: `${f1(hours).replace(/\.0$/, "")} h · ${quality}`,
      m: sleepMultiplier(hours, quality),
      tex: String.raw`m_s=\operatorname{clamp}\!\big(1+0.04\,(h-7.5)+q,\;0.6,\;1.1\big)`,
      texValues: String.raw`m_s=1+0.04\,(${f1(hours)}-7.5)${q < 0 ? "-" : "+"}${Math.abs(q).toFixed(2)}=${f2(sleepMultiplier(hours, quality))}`,
      source: "you",
    });
  }
  if (inp.weather) {
    const w = inp.weather;
    out.push({
      id: "pressure",
      label: "Pressure",
      reading: `${signed(w.delta24)} hPa / 24 h`,
      m: pressureMultiplier(w.delta24),
      tex: String.raw`m_p=1-\alpha\,\frac{\max(0,\,-\Delta P_{24})}{10},\quad \alpha=0.06`,
      texValues: String.raw`m_p=1-0.06\cdot\frac{${f1(Math.max(0, -w.delta24))}}{10}=${f2(pressureMultiplier(w.delta24))}`,
      source: w.source,
    });
    if (w.tempC > COEF.heat.threshold) {
      out.push({
        id: "heat",
        label: "Heat",
        reading: `${Math.round(w.tempC)}°C`,
        m: heatMultiplier(w.tempC),
        tex: String.raw`m_T=1-\gamma\,\frac{\max(0,\,T-24)}{10},\quad \gamma=0.12`,
        texValues: String.raw`m_T=1-0.12\cdot\frac{${f1(w.tempC - 24)}}{10}=${f2(heatMultiplier(w.tempC))}`,
        source: w.source,
      });
    }
  }
  const { d1, d2 } = inp.history;
  if (d1 || d2) {
    const o1 = overshoot(d1);
    const o2 = overshoot(d2);
    out.push({
      id: "pem",
      label: "Last 2 days",
      reading: o1 + o2 === 0 ? "within budget" : `${o2 > o1 ? "2 days ago" : "yesterday"} +${Math.round(Math.max(o1, o2) * 100)}%`,
      m: pemMultiplier(o1, o2),
      tex: String.raw`m_{\text{pem}}=1-\beta_1 o_1-\beta_2 o_2,\quad o_t=\max\!\Big(0,\tfrac{S_t}{B_t}-1\Big)`,
      texValues: String.raw`m_{\text{pem}}=1-0.2\cdot${f2(o1)}-0.3\cdot${f2(o2)}=${f2(pemMultiplier(o1, o2))}`,
      source: "you",
    });
  }
  const b = inp.body;
  if (b.restingHrDelta !== undefined && b.restingHrDelta > 0) {
    out.push({
      id: "restingHr",
      label: "Resting HR",
      reading: `${signed(b.restingHrDelta, 0)} bpm`,
      m: restingHrMultiplier(b.restingHrDelta),
      tex: String.raw`m_{hr}=1-0.012\,\max(0,\Delta\text{RHR})`,
      texValues: String.raw`m_{hr}=1-0.012\cdot${f1(b.restingHrDelta)}=${f2(restingHrMultiplier(b.restingHrDelta))}`,
      source: "wearable",
    });
  }
  if (b.hrvDeltaPct !== undefined && b.hrvDeltaPct < 0) {
    out.push({
      id: "hrv",
      label: "HRV",
      reading: `${signed(b.hrvDeltaPct, 0)}%`,
      m: hrvMultiplier(b.hrvDeltaPct),
      tex: String.raw`m_{hrv}=1-0.003\,\max(0,-\Delta\text{HRV}\%)`,
      texValues: String.raw`m_{hrv}=1-0.003\cdot${f1(-b.hrvDeltaPct)}=${f2(hrvMultiplier(b.hrvDeltaPct))}`,
      source: "wearable",
    });
  }
  if (b.cyclePhase && COEF.cycle[b.cyclePhase] < 1) {
    out.push({
      id: "cycle",
      label: "Cycle",
      reading: b.cyclePhase,
      m: COEF.cycle[b.cyclePhase],
      tex: String.raw`m_c\in\{0.93_{\text{menstrual}},\,0.97_{\text{luteal}},\,1\}`,
      texValues: String.raw`m_c=${f2(COEF.cycle[b.cyclePhase])}`,
      source: "you",
    });
  }
  if (b.stress !== undefined && b.stress > COEF.stress.threshold) {
    out.push({
      id: "stress",
      label: "Stress",
      reading: `${b.stress}/10`,
      m: stressMultiplier(b.stress),
      tex: String.raw`m_\sigma=1-0.025\,\max(0,\,s-5)`,
      texValues: String.raw`m_\sigma=1-0.025\cdot${f1(b.stress - 5)}=${f2(stressMultiplier(b.stress))}`,
      source: "you",
    });
  }
  return out;
}

export interface Budget {
  /** E · k before any multipliers. */
  base: number;
  /** Π mᵢ. */
  product: number;
  /** Exact budget E · k · Π mᵢ. */
  exact: number;
  /** Budget used for planning, rounded to the nearest half spoon. */
  value: number;
  k: number;
  factors: Factor[];
}

/**
 * B = E · k · Π mᵢ.
 * Each factor's contribution in spoons uses log-share attribution,
 *   Δᵢ = (B − E·k) · ln mᵢ / Σⱼ ln mⱼ,
 * which is order-independent and sums exactly to the total change.
 */
export function budget(inp: ModelInputs): Budget {
  const k = clamp(inp.k, K_MIN, K_MAX);
  const E = inp.energy === null ? 0 : clamp(inp.energy, 0, 10);
  const raw = rawFactors(inp);
  const product = raw.reduce((p, f) => p * f.m, 1);
  const base = E * k;
  const exact = base * product;
  const lnSum = raw.reduce((s, f) => s + Math.log(f.m), 0);
  const delta = exact - base;
  const factors = raw.map((f) => ({
    ...f,
    spoons: lnSum === 0 ? 0 : (delta * Math.log(f.m)) / lnSum,
  }));
  return { base, product, exact, value: Math.round(exact * 2) / 2, k, factors };
}

/* --------------------------------------------- 2. Bayesian activity costs */

export interface Prior {
  type: string;
  mu: number;
  sigma: number;
}

/** Illustrative population priors per activity type, in spoons (mean, sd). */
export const PRIORS: { type: string; match: RegExp; mu: number; sigma: number }[] = [
  { type: "simple meal", match: /one[- ]?pan|microwave|sandwich|simple|ready meal|leftover|toast/i, mu: 1.5, sigma: 0.6 },
  { type: "phone call", match: /phone|call/i, mu: 1, sigma: 0.4 },
  { type: "personal care", match: /shower|bath|wash|hair|dress/i, mu: 2, sigma: 0.6 },
  { type: "appointment", match: /gp|doctor|hospital|appointment|clinic|dentist|physio|scan|blood/i, mu: 4, sigma: 1.2 },
  { type: "cooking", match: /cook|dinner|lunch|meal|bake|breakfast/i, mu: 3.5, sigma: 1.2 },
  { type: "errand", match: /shop|supermarket|grocer|pharmacy|post office|errand/i, mu: 3.5, sigma: 1 },
  { type: "chores", match: /laundry|clean|tidy|hoover|vacuum|dishes|chores/i, mu: 2.5, sigma: 0.8 },
  { type: "social", match: /friend|visit|party|coffee|family|date|pub/i, mu: 3, sigma: 1.2 },
  { type: "movement", match: /walk|yoga|stretch|physio exercises|swim|gym/i, mu: 2, sigma: 0.8 },
  { type: "desk work", match: /work|email|desk|meeting|study|admin/i, mu: 2, sigma: 0.8 },
];
export const DEFAULT_PRIOR: Prior = { type: "activity", mu: 2.5, sigma: 1.5 };
/** How noisy a single spoken estimate is, in spoons (sd). */
export const SIGMA_OBS = 0.8;

export const priorFor = (text: string): Prior => {
  const hit = PRIORS.find((p) => p.match.test(text));
  return hit ? { type: hit.type, mu: hit.mu, sigma: hit.sigma } : DEFAULT_PRIOR;
};

export interface Posterior {
  prior: Prior;
  observations: number[];
  mu: number;
  sigma: number;
}

/**
 * Conjugate Normal–Normal update with known observation noise σₓ:
 *   1/σ² = 1/σ₀² + n/σₓ²,   μ = σ² (μ₀/σ₀² + Σx/σₓ²)
 */
export function posterior(prior: Prior, observations: number[], sigmaObs = SIGMA_OBS): Posterior {
  const precision = 1 / prior.sigma ** 2 + observations.length / sigmaObs ** 2;
  const variance = 1 / precision;
  const mu = variance * (prior.mu / prior.sigma ** 2 + observations.reduce((s, x) => s + x, 0) / sigmaObs ** 2);
  return { prior, observations, mu, sigma: Math.sqrt(variance) };
}

/* ------------------------------------------------------ 3. plan + crash risk */

export interface PlanCost {
  mu: number;
  sigma: number;
}

export interface PlanTotals {
  /** Σ μⱼ − rest credits. */
  used: number;
  /** √Σσⱼ² (activities assumed independent). */
  sigma: number;
  left: number;
  /** P(actual use > B) under the Normal approximation. */
  pOver: number;
}

export function planTotals(costs: PlanCost[], credits: number, B: number): PlanTotals {
  const spent = costs.reduce((s, c) => s + c.mu, 0);
  const used = Math.max(0, spent - credits);
  const sigma = Math.sqrt(costs.reduce((s, c) => s + c.sigma ** 2, 0));
  const pOver = B <= 0 ? (used > 0 ? 1 : 0) : sigma === 0 ? (used > B ? 1 : 0) : 1 - normalCdf((B - used) / sigma);
  return { used, sigma, left: B - used, pOver };
}

/** Illustrative logistic weights. Not fitted, not validated. */
export const W = { w0: -3.4, overspend: 6, o1: 2, o2: 2.5, sleepDebt: 0.3, pressureDrop: 0.8 } as const;

export type RiskTermId = "overspend" | "o1" | "o2" | "sleepDebt" | "pressureDrop";

export interface RiskTerm {
  id: RiskTermId;
  label: string;
  x: number;
  w: number;
  /** wᵢ·xᵢ, the term's contribution to the log-odds. */
  contribution: number;
}

export interface CrashRisk {
  z: number;
  p: number;
  level: "low" | "moderate" | "high";
  terms: RiskTerm[];
}

/**
 * p = σ(w₀ + w₁·x_over + w₂·o₁ + w₃·o₂ + w₄·d_sleep + w₅·x_P)
 *   x_over  = max(0, U/B − 0.75)     plan above 75% of today's budget
 *   o₁, o₂  = past overshoot, lags 1 and 2 (PEM is often delayed 24–48 h)
 *   d_sleep = max(0, 7.5 − h)        hours of sleep debt
 *   x_P     = max(0, −ΔP₂₄) / 10     pressure drop, per 10 hPa
 */
export function crashRisk(inp: ModelInputs, used: number, B: number): CrashRisk {
  const raw: Omit<RiskTerm, "contribution">[] = [
    { id: "overspend", label: "Plan above 75% of budget", x: B > 0 ? Math.max(0, used / B - 0.75) : 0, w: W.overspend },
    { id: "o1", label: "Overdid it yesterday", x: overshoot(inp.history.d1), w: W.o1 },
    { id: "o2", label: "Overdid it 2 days ago", x: overshoot(inp.history.d2), w: W.o2 },
    { id: "sleepDebt", label: "Sleep debt", x: inp.sleep ? Math.max(0, COEF.sleep.centre - inp.sleep.hours) : 0, w: W.sleepDebt },
    { id: "pressureDrop", label: "Falling pressure", x: inp.weather ? Math.max(0, -inp.weather.delta24) / 10 : 0, w: W.pressureDrop },
  ];
  const terms: RiskTerm[] = raw.map((t) => ({ ...t, contribution: t.w * t.x }));
  const z = terms.reduce((s, t) => s + t.contribution, W.w0 as number);
  const p = sigmoid(z);
  return { z, p, level: p >= 0.6 ? "high" : p >= 0.35 ? "moderate" : "low", terms };
}

export const topTerms = (risk: CrashRisk, n = 2) =>
  [...risk.terms].filter((t) => t.contribution > 0.05).sort((a, b) => b.contribution - a.contribution).slice(0, n);
