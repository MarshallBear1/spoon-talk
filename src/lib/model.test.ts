import { describe, expect, it } from "vitest";
import {
  K_DEFAULT,
  budget,
  crashRisk,
  heatMultiplier,
  normalCdf,
  overshoot,
  pemMultiplier,
  planTotals,
  posterior,
  pressureMultiplier,
  priorFor,
  sleepMultiplier,
  topTerms,
  type ModelInputs,
} from "./model";
import { parseOpenMeteo } from "./weather";
import { dayReducer, derive, describe as describeDay, initialDay, type DayAction } from "./spoons";
import { DEMO_SCRIPT } from "./demo-script";

const base: ModelInputs = {
  energy: 5,
  sleep: null,
  weather: null,
  history: { d1: null, d2: null },
  body: {},
  k: K_DEFAULT,
};

describe("budget multipliers", () => {
  it("sleep is neutral at 7.5 h and bounded", () => {
    expect(sleepMultiplier(7.5, "ok")).toBeCloseTo(1);
    expect(sleepMultiplier(5, "poor")).toBeCloseTo(0.86);
    expect(sleepMultiplier(0, "poor")).toBeCloseTo(0.66);
    expect(sleepMultiplier(-10, "poor")).toBe(0.6);
    expect(sleepMultiplier(16, "good")).toBe(1.1);
  });

  it("pressure only penalises falls", () => {
    expect(pressureMultiplier(+12)).toBe(1);
    expect(pressureMultiplier(-9)).toBeCloseTo(0.946);
    expect(pressureMultiplier(-80)).toBe(0.85);
  });

  it("heat only penalises above 24°C", () => {
    expect(heatMultiplier(20)).toBe(1);
    expect(heatMultiplier(34)).toBeCloseTo(0.88);
  });

  it("PEM lag uses overshoot o_t = max(0, S/B - 1) with heavier lag-2 weight", () => {
    expect(overshoot({ spent: 8, budget: 10 })).toBe(0);
    expect(overshoot({ spent: 15, budget: 10 })).toBeCloseTo(0.5);
    expect(pemMultiplier(0.5, 0)).toBeGreaterThan(pemMultiplier(0, 0.5));
    expect(pemMultiplier(5, 5)).toBe(0.6);
  });
});

describe("budget B = E·k·Πm", () => {
  it("is E·k with no factors", () => {
    const b = budget(base);
    expect(b.exact).toBeCloseTo(12);
    expect(b.factors).toHaveLength(0);
  });

  it("clamps k to [1.2, 4.0]", () => {
    expect(budget({ ...base, k: 9 }).exact).toBeCloseTo(20);
    expect(budget({ ...base, k: 0 }).exact).toBeCloseTo(6);
  });

  it("log-share attribution sums exactly to the total change", () => {
    const b = budget({
      ...base,
      sleep: { hours: 5, quality: "poor" },
      weather: { pressure: 1003, delta24: -9, tempC: 14, place: "x", source: "demo" },
      history: { d1: { spent: 7, budget: 9 }, d2: { spent: 15, budget: 11 } },
    });
    const sum = b.factors.reduce((s, f) => s + f.spoons, 0);
    expect(sum).toBeCloseTo(b.exact - b.base, 10);
    expect(b.factors.every((f) => f.spoons <= 0)).toBe(true);
    expect(b.value % 0.5).toBe(0);
  });
});

describe("Bayesian activity costs", () => {
  it("picks priors by activity type, most specific first", () => {
    expect(priorFor("Cook dinner one pan").type).toBe("simple meal");
    expect(priorFor("Cook dinner from scratch").type).toBe("cooking");
    expect(priorFor("GP appointment").type).toBe("appointment");
    expect(priorFor("Something odd").type).toBe("activity");
  });

  it("posterior mean lies between prior and observation and shrinks sigma", () => {
    const prior = { type: "t", mu: 4, sigma: 1.2 };
    const post = posterior(prior, [4.5]);
    expect(post.mu).toBeGreaterThan(4);
    expect(post.mu).toBeLessThan(4.5);
    expect(post.sigma).toBeLessThan(prior.sigma);
    // closed form: 1/σ² = 1/1.44 + 1/0.64
    expect(post.sigma).toBeCloseTo(Math.sqrt(1 / (1 / 1.44 + 1 / 0.64)), 10);
  });

  it("more observations mean more certainty", () => {
    const prior = { type: "t", mu: 2, sigma: 1 };
    expect(posterior(prior, [3, 3, 3]).sigma).toBeLessThan(posterior(prior, [3]).sigma);
  });
});

describe("plan totals and crash risk", () => {
  it("normal CDF is accurate", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it("propagates uncertainty as √Σσ² and gives P(over)", () => {
    const t = planTotals([{ mu: 3, sigma: 0.3 }, { mu: 4, sigma: 0.4 }], 1, 6);
    expect(t.used).toBe(6);
    expect(t.sigma).toBeCloseTo(0.5);
    expect(t.pOver).toBeCloseTo(0.5);
  });

  it("risk is a logistic of its terms and rises with each driver", () => {
    const calm = crashRisk(base, 6, 12);
    const tired = crashRisk({ ...base, sleep: { hours: 4, quality: "poor" } }, 6, 12);
    const heavy = crashRisk({ ...base, sleep: { hours: 4, quality: "poor" }, history: { d1: null, d2: { spent: 18, budget: 10 } } }, 11, 12);
    expect(calm.p).toBeLessThan(tired.p);
    expect(tired.p).toBeLessThan(heavy.p);
    expect(heavy.z).toBeCloseTo(heavy.terms.reduce((s, t) => s + t.contribution, -3.4), 10);
    // The heavy day two days ago dominates: the delayed (lag-2) PEM term.
    expect(topTerms(heavy)[0].id).toBe("o2");
  });
});

describe("Open-Meteo parsing", () => {
  it("computes ΔP₂₄ from the hourly series", () => {
    const time = Array.from({ length: 48 }, (_, i) => `2026-10-12T${String(i % 24).padStart(2, "0")}:00`).map((t, i) =>
      i < 24 ? t : t.replace("10-12", "10-13"),
    );
    const surface_pressure = time.map((_, i) => 1015 - i * 0.5);
    const temperature_2m = time.map(() => 12);
    const w = parseOpenMeteo(
      { hourly: { time, surface_pressure, temperature_2m }, utc_offset_seconds: 0 },
      new Date("2026-10-13T12:30:00Z"),
      "Test",
      "live",
    );
    expect(w?.delta24).toBeCloseTo(-12);
    expect(w?.pressure).toBeCloseTo(1015 - 36 * 0.5);
  });
});

describe("demo script drives the model to the intended story", () => {
  const run = (until?: (s: (typeof DEMO_SCRIPT)[number]) => boolean) => {
    let day = initialDay();
    for (const step of DEMO_SCRIPT) {
      if (until?.(step)) break;
      if (step.kind === "tool") day = dayReducer(day, step.action as DayAction);
    }
    return day;
  };

  it("goes over budget with a high crash risk before the trade-off", () => {
    const day = run((s) => s.kind === "say" && s.text.includes("sneaks up"));
    const d = derive(day);
    expect(d.totals.left).toBeLessThan(0);
    expect(d.risk.level).toBe("high");
    expect(describeDay(day)).toContain("OVER");
  });

  it("ends within budget with a low crash risk", () => {
    const d = derive(run());
    expect(d.totals.left).toBeGreaterThan(1.5);
    expect(d.risk.level).toBe("low");
    expect(d.budget.factors.map((f) => f.id)).toEqual(expect.arrayContaining(["sleep", "pressure", "pem"]));
  });
});
