"use client";

import {
  ConversationProvider,
  useConversation,
  useConversationClientTool,
  type MessagePayload,
} from "@elevenlabs/react";
import { Mic, Play, Square } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatedGridPattern } from "@/components/ui/animated-grid-pattern";
import { Button } from "@/components/ui/button";
import { LiveWaveform } from "@/components/ui/live-waveform";
import type { AgentState } from "@/components/ui/orb";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { ShimmeringText } from "@/components/ui/shimmering-text";
import { DEMO_SCRIPT, speakMs } from "@/lib/demo-script";
import {
  dayReducer,
  derive,
  describe,
  initialDay,
  num,
  optNum,
  toPhase,
  toQuality,
  toSlot,
  type DayAction,
  type DayState,
} from "@/lib/spoons";
import { cn } from "@/lib/utils";
import { fetchWeather, locate } from "@/lib/weather";
import { DayPlan } from "./DayPlan";
import { MathsSection } from "./MathsSection";

// The ElevenLabs UI orb is WebGL (three.js / react-three-fiber): client only.
const Orb = dynamic(() => import("@/components/ui/orb").then((m) => m.Orb), {
  ssr: false,
  loading: () => <div className="size-full rounded-full bg-[radial-gradient(circle,rgba(180,169,255,0.25),transparent_65%)]" />,
});

type Mode = "idle" | "demo" | "demo-done" | "connecting" | "live";

/** Tool arguments come from an LLM, so every field is treated as untrusted and coerced. */
type Tools = {
  set_energy: (p: { level?: unknown }) => string;
  set_sleep: (p: { hours?: unknown; quality?: unknown }) => string;
  log_previous_day: (p: { days_ago?: unknown; spent?: unknown; budget?: unknown }) => string;
  set_body_signals: (p: { resting_hr_delta?: unknown; hrv_delta_pct?: unknown; cycle_phase?: unknown; stress?: unknown }) => string;
  add_activity: (p: { name?: unknown; spoons?: unknown; when?: unknown; note?: unknown }) => string;
  remove_activity: (p: { name?: unknown }) => string;
  suggest_rest: (p: { after?: unknown; minutes?: unknown }) => string;
  flag_crash_risk: (p: { reason?: unknown }) => string;
};

// Soft pastels: in dark mode the orb inverts, so these read as glowing lavender / mint (or peach on crash risk).
const CALM: [string, string] = ["#DCD6FF", "#AEEBE1"];
const WARM: [string, string] = ["#FFD9BF", "#FFB9C2"];

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(id);
      reject(new DOMException("aborted", "AbortError"));
    });
  });

const toolLabel = (a: DayAction): string => {
  switch (a.type) {
    case "set_energy":
      return `set_energy(${a.level})`;
    case "set_sleep":
      return `set_sleep(${a.hours}h, "${a.quality}")`;
    case "log_previous_day":
      return `log_previous_day(${a.daysAgo}, spent ${a.record.spent}, budget ${a.record.budget})`;
    case "set_body_signals":
      return "set_body_signals(…)";
    case "set_weather":
      return `open-meteo: ΔP₂₄ ${a.weather.delta24} hPa, ${Math.round(a.weather.tempC)}°C`;
    case "add_activity":
      return `add_activity("${a.name}", ${a.spoons}, "${a.when}")`;
    case "remove_activity":
      return `remove_activity("${a.name}")`;
    case "suggest_rest":
      return `suggest_rest(after "${a.after}", ${a.minutes} min)`;
    case "flag_crash_risk":
      return "flag_crash_risk(…)";
    default:
      return "";
  }
};

function SpoonTalkInner({ liveAvailable }: { liveAvailable: boolean }) {
  const [day, setDay] = useState<DayState>(() => initialDay());
  const dayRef = useRef(day);
  const [mode, setMode] = useState<Mode>("idle");
  const [demoSpeaker, setSpeaker] = useState<"agent" | "user" | null>(null);
  const [caption, setCaption] = useState<{ role: "agent" | "user"; text: string; words: number } | null>(null);
  const [lastTool, setLastTool] = useState<{ id: number; label: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const planRef = useRef<HTMLDivElement>(null);

  const apply = useCallback((action: DayAction, quiet = false) => {
    const next = dayReducer(dayRef.current, action);
    dayRef.current = next;
    setDay(next);
    const label = toolLabel(action);
    if (label && !quiet) setLastTool({ id: Date.now() + Math.random(), label });
    return next;
  }, []);

  const resetDay = useCallback(() => {
    const fresh = initialDay(dayRef.current.weather);
    dayRef.current = fresh;
    setDay(fresh);
    setCaption(null);
    setLastTool(null);
  }, []);

  const d = useMemo(() => derive(day), [day]);

  /* ---------------- Live: ElevenLabs Agent with client tools ---------------- */

  const conversation = useConversation({
    onMessage: (m: MessagePayload) => {
      const role = m.role === "user" ? "user" : "agent";
      if (!m.message?.trim()) return;
      apply({ type: "line", role, text: m.message }, true);
      setCaption({ role, text: m.message, words: Infinity });
    },
    onError: (message: string) => setNotice(message || "Voice session error."),
    onDisconnect: () => {
      setMode((m) => (m === "live" || m === "connecting" ? "demo-done" : m));
      setSpeaker(null);
    },
    onConnect: () => setMode("live"),
  });

  const sendWeatherContext = useCallback(() => {
    const w = dayRef.current.weather;
    if (!w) return;
    conversation.sendContextualUpdate(
      `Local weather from Open-Meteo (${w.source === "live" ? "their location" : "London fallback"}): surface pressure ${Math.round(w.pressure)} hPa, change over 24 h ${w.delta24} hPa, temperature ${Math.round(w.tempC)}°C. It is already applied to the budget.`,
    );
  }, [conversation]);

  const readout = () => describe(dayRef.current);

  useConversationClientTool<Tools, "set_energy">("set_energy", (p) => {
    apply({ type: "set_energy", level: num(p.level, 5) });
    return readout();
  });
  useConversationClientTool<Tools, "set_sleep">("set_sleep", (p) => {
    apply({ type: "set_sleep", hours: num(p.hours, 7), quality: toQuality(p.quality) });
    return readout();
  });
  useConversationClientTool<Tools, "log_previous_day">("log_previous_day", (p) => {
    const daysAgo = num(p.days_ago, 1) >= 2 ? 2 : 1;
    apply({ type: "log_previous_day", daysAgo, record: { spent: num(p.spent, 0), budget: num(p.budget, 10) } });
    return readout();
  });
  useConversationClientTool<Tools, "set_body_signals">("set_body_signals", (p) => {
    apply({
      type: "set_body_signals",
      restingHrDelta: optNum(p.resting_hr_delta),
      hrvDeltaPct: optNum(p.hrv_delta_pct),
      cyclePhase: toPhase(p.cycle_phase),
      stress: optNum(p.stress),
    });
    return readout();
  });
  useConversationClientTool<Tools, "add_activity">("add_activity", (p) => {
    apply({
      type: "add_activity",
      name: String(p.name ?? "Activity"),
      spoons: num(p.spoons, 1),
      when: toSlot(p.when),
      note: p.note ? String(p.note) : undefined,
    });
    return readout();
  });
  useConversationClientTool<Tools, "remove_activity">("remove_activity", (p) => {
    apply({ type: "remove_activity", name: String(p.name ?? "") });
    return readout();
  });
  useConversationClientTool<Tools, "suggest_rest">("suggest_rest", (p) => {
    apply({ type: "suggest_rest", after: String(p.after ?? ""), minutes: num(p.minutes, 30) });
    return readout();
  });
  useConversationClientTool<Tools, "flag_crash_risk">("flag_crash_risk", (p) => {
    apply({ type: "flag_crash_risk", reason: String(p.reason ?? "") });
    return readout();
  });

  useEffect(() => {
    if (mode === "live") sendWeatherContext();
  }, [mode, sendWeatherContext]);

  const scrollToPlan = () => {
    if (window.matchMedia("(max-width: 1023px)").matches) {
      planRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  /* ---------------- Demo: scripted playback, same reducer ---------------- */

  const runDemo = useCallback(
    async (opts: { speed?: number } = {}) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;
      const speed = opts.speed ?? 1;
      resetDay();
      setMode("demo");
      try {
        await sleep(900 / speed, signal);
        for (const step of DEMO_SCRIPT) {
          if (step.kind === "pause") {
            await sleep(step.ms / speed, signal);
          } else if (step.kind === "tool") {
            setSpeaker(null);
            apply(step.action);
            await sleep(480 / speed, signal);
          } else {
            const words = step.text.split(/\s+/).length;
            const total = speakMs(step.text, step.role) / speed;
            setSpeaker(step.role);
            apply({ type: "line", role: step.role, text: step.text }, true);
            for (let w = 1; w <= words; w++) {
              setCaption({ role: step.role, text: step.text, words: w });
              await sleep(total / words, signal);
            }
            setSpeaker(null);
            await sleep(480 / speed, signal);
          }
        }
        setMode("demo-done");
      } catch {
        /* aborted */
      } finally {
        setSpeaker(null);
      }
    },
    [apply, resetDay],
  );

  const watchDemo = () => {
    setNotice(null);
    void runDemo();
  };

  const startLive = async () => {
    setNotice(null);
    if (!liveAvailable) {
      setNotice("Live voice isn't switched on here yet, so here's the scripted demo.");
      void runDemo();
      return;
    }
    resetDay();
    setMode("connecting");
    try {
      const [res, where] = await Promise.all([fetch("/api/conversation-token", { cache: "no-store" }), locate()]);
      const weather = await fetchWeather(where, where.live ? "live" : "fallback").catch(() => null);
      if (weather) apply({ type: "set_weather", weather }, true);
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) throw new Error(data.error ?? "Could not start a voice session.");
      // Ask for the mic up front so the permission prompt isn't racing the connection.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      conversation.startSession({ conversationToken: data.token, connectionType: "webrtc" });
      scrollToPlan();
    } catch (e) {
      setMode("idle");
      setNotice(e instanceof Error ? e.message : "Could not start a voice session.");
    }
  };

  const stop = () => {
    if (mode === "demo") {
      abortRef.current?.abort();
      setMode("demo-done");
    } else conversation.endSession();
  };

  /* -------- URL flags: ?demo=play autoplays; ?demo=crash|end freeze a frame -------- */

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const demo = params.get("demo");
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (demo === "play") {
      timer = setTimeout(() => void runDemo({ speed: num(params.get("speed"), 1) }), 0);
    } else if (demo === "end" || demo === "crash") {
      const stopAt =
        demo === "crash"
          ? DEMO_SCRIPT.findIndex((s) => s.kind === "say" && s.text.includes("sneaks up"))
          : DEMO_SCRIPT.findLastIndex((s) => s.kind === "say" && s.text.includes("one in four"));
      timer = setTimeout(() => {
        DEMO_SCRIPT.slice(0, stopAt + 1).forEach((step) => {
          if (step.kind === "tool") apply(step.action, true);
          if (step.kind === "say") apply({ type: "line", role: step.role, text: step.text }, true);
        });
        const line = DEMO_SCRIPT[stopAt];
        if (line?.kind === "say") setCaption({ role: "agent", text: line.text, words: Infinity });
        setLastTool({ id: 1, label: demo === "crash" ? 'add_activity("Cook dinner", 4, "evening")' : 'suggest_rest(after "Shower", 30 min)' });
        setSpeaker("agent");
        setMode("demo-done");
      }, 0);
    } else {
      // Landing: show today's real pressure (London) without asking for location.
      fetchWeather(undefined, "fallback", ctrl.signal)
        .then((w) => {
          if (w && !dayRef.current.weather) apply({ type: "set_weather", weather: w }, true);
        })
        .catch(() => {});
    }
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [apply, runDemo]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /* ---------------- Orb + derived UI state ---------------- */

  const speaker = mode === "live" ? (conversation.isSpeaking ? "agent" : "user") : demoSpeaker;
  const busy = mode === "demo" || mode === "live" || mode === "connecting";
  const started = mode !== "idle";
  const warn = d.hasPlan && d.risk.level !== "low";

  const agentState: AgentState =
    mode === "connecting"
      ? "thinking"
      : speaker === "agent"
        ? "talking"
        : speaker === "user"
          ? "listening"
          : mode === "demo" || mode === "live"
            ? "thinking"
            : null;

  const colorsRef = useRef<[string, string]>(CALM);
  useEffect(() => {
    colorsRef.current = warn ? WARM : CALM;
  }, [warn]);

  const status =
    mode === "connecting"
      ? "Connecting"
      : mode === "live"
        ? conversation.isSpeaking
          ? "Speaking"
          : "Listening"
        : mode === "demo" || mode === "demo-done"
          ? "Demo · scripted"
          : "ElevenLabs Agents · client tools";

  const visibleCaption = caption
    ? caption.text
        .split(/\s+/)
        .slice(0, caption.words === Infinity ? undefined : caption.words)
        .join(" ")
    : null;

  return (
    <LayoutGroup>
      <section
        className={cn(
          "relative grid w-full gap-10",
          started ? "items-start lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-14" : "grid-cols-1 justify-items-center",
        )}
      >
        {/* Background effect, anchored to the hero */}
        <div className="pointer-events-none absolute inset-x-[-10vw] -top-24 h-[760px] overflow-hidden" aria-hidden="true">
          <AnimatedGridPattern
            numSquares={26}
            maxOpacity={0.07}
            duration={4}
            width={56}
            height={56}
            className="fill-white/[0.06] stroke-white/[0.05] [mask-image:radial-gradient(520px_circle_at_50%_42%,white,transparent)]"
          />
          <div
            className={cn(
              "absolute top-[18%] left-1/2 h-[520px] w-[720px] -translate-x-1/2 rounded-full blur-3xl transition-colors duration-1000",
              warn ? "bg-[#f6a76b]/[0.07]" : "bg-[#9d8cff]/[0.08]",
            )}
          />
        </div>

        {/* Stage */}
        <motion.div
          layout
          transition={{ type: "spring", stiffness: 140, damping: 24 }}
          className={cn("relative z-10 flex w-full flex-col items-center text-center", started && "lg:sticky lg:top-6")}
        >
          <motion.div layout="position" className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[12px] text-white/55 backdrop-blur">
            <span className={cn("size-1.5 rounded-full", mode === "live" ? "bg-rest" : busy ? "animate-pulse bg-white/70" : "bg-violet-300")} />
            {status}
          </motion.div>

          <AnimatePresence initial={false} mode="popLayout">
            {!started && (
              <motion.div
                key="headline"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16, filter: "blur(8px)" }}
                transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
                className="flex flex-col items-center"
              >
                <h1 className="text-[44px] leading-[0.98] font-semibold tracking-[-0.045em] text-white sm:text-[72px]">
                  Plan your day <br className="sm:hidden" />
                  in spoons.
                  <br />
                  <span className="text-gradient">Just talk.</span>
                </h1>
                <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/50 sm:text-base">
                  A voice agent that budgets your energy, prices each task and warns you before tomorrow&apos;s crash.
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div
            layout
            transition={{ type: "spring", stiffness: 140, damping: 24 }}
            className={cn("relative aspect-square", started ? "mt-1 w-[220px] sm:w-[300px]" : "mt-6 w-[260px] sm:w-[340px]")}
          >
            <div
              aria-hidden="true"
              className={cn(
                "absolute inset-[-14%] rounded-full opacity-70 blur-3xl transition-colors duration-1000",
                warn ? "bg-[radial-gradient(circle,rgba(246,167,107,0.35),transparent_65%)]" : "bg-[radial-gradient(circle,rgba(157,140,255,0.35),transparent_65%)]",
              )}
            />
            <div aria-hidden="true" className="absolute inset-[-3%] rounded-full border border-white/[0.06]" />
            {/* Screen-blend + soft radial mask: the orb's dark (inverted) gaps melt into the page and the petals glow. */}
            <div className="relative size-full mix-blend-screen [mask-image:radial-gradient(circle,#000_55%,transparent_71%)]">
              <Orb
                colors={CALM}
                colorsRef={colorsRef}
                seed={7}
                agentState={agentState}
                volumeMode={mode === "live" ? "manual" : "auto"}
                getInputVolume={mode === "live" ? conversation.getInputVolume : undefined}
                getOutputVolume={mode === "live" ? conversation.getOutputVolume : undefined}
                className="size-full"
              />
            </div>
          </motion.div>

          <div className={cn("h-10 w-full max-w-[260px] transition-opacity duration-500", busy ? "opacity-100" : "opacity-0")}>
            <LiveWaveform
              active={mode === "live" && !conversation.isSpeaking}
              processing={speaker === "agent" || mode === "connecting"}
              height={40}
              barWidth={3}
              barGap={2}
              barColor="rgba(255,255,255,0.55)"
              mode="static"
              fadeEdges
            />
          </div>

          {started && (
            <div className="flex min-h-[124px] w-full max-w-[520px] flex-col items-center justify-start" aria-live="polite">
              <AnimatePresence mode="wait">
                {visibleCaption ? (
                  <motion.div
                    key={caption!.text}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
                    transition={{ duration: 0.3 }}
                    className="flex flex-col items-center gap-2"
                  >
                    <span className="text-[11px] tracking-[0.16em] text-white/35 uppercase">
                      {caption!.role === "agent" ? "Spoon Talk" : "You"}
                    </span>
                    <p
                      className={cn(
                        "text-[20px] leading-[1.35] tracking-[-0.01em] text-balance sm:text-[24px]",
                        caption!.role === "agent" ? "text-white" : "text-white/55 italic",
                      )}
                    >
                      {visibleCaption}
                    </p>
                  </motion.div>
                ) : (
                  <motion.div key="wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-6 text-lg">
                    <ShimmeringText text={mode === "connecting" ? "Connecting…" : "Listening…"} color="rgba(255,255,255,0.35)" shimmerColor="#fff" />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          <div className="mt-4 flex flex-col items-center gap-3">
            {busy ? (
              <Button variant="outline" size="lg" onClick={stop} className="h-11 rounded-full border-white/15 bg-white/[0.04] px-5">
                <Square className="size-3.5 fill-current" /> {mode === "demo" ? "Stop demo" : "End conversation"}
              </Button>
            ) : (
              <div className="flex flex-col items-center gap-3 sm:flex-row">
                <ShimmerButton
                  onClick={startLive}
                  background="linear-gradient(180deg,#1c1a2b,#0e0d16)"
                  shimmerColor="#cfc8ff"
                  shimmerDuration="2.6s"
                  className="h-12 gap-2 px-6 text-[15px] font-medium shadow-[0_0_40px_-8px_rgba(157,140,255,0.55)]"
                >
                  <Mic className="size-4" /> Start talking
                </ShimmerButton>
                <Button variant="ghost" size="lg" onClick={watchDemo} className="h-12 rounded-full px-5 text-white/60 hover:text-white">
                  <Play className="size-3.5 fill-current" /> {mode === "demo-done" ? "Replay the demo" : "Watch the demo"}
                </Button>
              </div>
            )}
            {notice && <p className="max-w-xs text-[13px] text-white/50">{notice}</p>}
          </div>

          <div className="mt-3 flex h-6 items-center justify-center">
            <AnimatePresence mode="wait">
              {lastTool && started && (
                <motion.code
                  key={lastTool.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="max-w-[88vw] truncate font-mono text-[11px] text-white/35"
                >
                  <span className="text-rest/80">client tool</span> {lastTool.label}
                </motion.code>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Plan */}
        <motion.section
          ref={planRef}
          layout
          transition={{ type: "spring", stiffness: 140, damping: 24 }}
          aria-label="Today's spoon plan"
          className={cn("panel relative z-10 w-full scroll-mt-6 rounded-[28px] p-5 sm:p-7", !started && "max-w-2xl")}
        >
          <DayPlan day={day} d={d} />
        </motion.section>
      </section>

      <motion.div layout className="relative z-10 mt-14 w-full">
        <MathsSection day={day} d={d} />
      </motion.div>
    </LayoutGroup>
  );
}

export function SpoonTalk({ liveAvailable }: { liveAvailable: boolean }) {
  return (
    <ConversationProvider>
      <SpoonTalkInner liveAvailable={liveAvailable} />
    </ConversationProvider>
  );
}
