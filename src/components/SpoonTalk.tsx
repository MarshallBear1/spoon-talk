"use client";

import {
  ConversationProvider,
  useConversation,
  useConversationClientTool,
  type MessagePayload,
} from "@elevenlabs/react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { DEMO_SCRIPT, speakMs } from "@/lib/demo-script";
import {
  dayReducer,
  describe,
  initialDay,
  num,
  toSlot,
  type CrashLevel,
  type DayAction,
  type DayState,
} from "@/lib/spoons";
import { DayPlan } from "./DayPlan";
import { Orb, type OrbState } from "./Orb";

type Mode = "idle" | "demo" | "demo-done" | "connecting" | "live";

/** Tool arguments come from an LLM, so every field is treated as untrusted and coerced. */
type Tools = {
  set_energy: (p: { level?: unknown; sleep_hours?: unknown }) => string;
  add_activity: (p: { name?: unknown; spoons?: unknown; when?: unknown; note?: unknown }) => string;
  remove_activity: (p: { name?: unknown }) => string;
  suggest_rest: (p: { after?: unknown; minutes?: unknown }) => string;
  flag_crash_risk: (p: { level?: unknown; reason?: unknown }) => string;
};

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(id);
      reject(new DOMException("aborted", "AbortError"));
    });
  });

const toolLabel = (action: DayAction): string => {
  switch (action.type) {
    case "set_energy":
      return `set_energy(level: ${action.level}${action.sleepHours ? `, sleep_hours: ${action.sleepHours}` : ""})`;
    case "add_activity":
      return `add_activity("${action.name}", ${action.spoons}, "${action.when}")`;
    case "remove_activity":
      return `remove_activity("${action.name}")`;
    case "suggest_rest":
      return `suggest_rest(after: "${action.after}", ${action.minutes} min)`;
    case "flag_crash_risk":
      return `flag_crash_risk("${action.level}")`;
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
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const apply = useCallback((action: DayAction) => {
    const next = dayReducer(dayRef.current, action);
    dayRef.current = next;
    setDay(next);
    const label = toolLabel(action);
    if (label) setLastTool({ id: Date.now() + Math.random(), label });
    return next;
  }, []);

  const resetDay = useCallback(() => {
    const fresh = initialDay();
    dayRef.current = fresh;
    setDay(fresh);
    setCaption(null);
    setLastTool(null);
  }, []);

  /* ---------------- Live: ElevenLabs Agent with client tools ---------------- */

  const conversation = useConversation({
    onMessage: (m: MessagePayload) => {
      const role = m.role === "user" ? "user" : "agent";
      if (!m.message?.trim()) return;
      apply({ type: "line", role, text: m.message });
      setCaption({ role, text: m.message, words: Infinity });
    },
    onError: (message: string) => setError(message || "Voice session error."),
    onDisconnect: () => {
      setMode((m) => (m === "live" || m === "connecting" ? "idle" : m));
      setSpeaker(null);
    },
    onConnect: () => setMode("live"),
  });

  useConversationClientTool<Tools, "set_energy">("set_energy", (p) =>
    describe(apply({ type: "set_energy", level: num(p.level, 5), sleepHours: p.sleep_hours == null ? null : num(p.sleep_hours, 0) })),
  );
  useConversationClientTool<Tools, "add_activity">("add_activity", (p) =>
    describe(
      apply({
        type: "add_activity",
        name: String(p.name ?? "Activity"),
        spoons: num(p.spoons, 1),
        when: toSlot(p.when),
        note: p.note ? String(p.note) : undefined,
      }),
    ),
  );
  useConversationClientTool<Tools, "remove_activity">("remove_activity", (p) =>
    describe(apply({ type: "remove_activity", name: String(p.name ?? "") })),
  );
  useConversationClientTool<Tools, "suggest_rest">("suggest_rest", (p) =>
    describe(apply({ type: "suggest_rest", after: String(p.after ?? ""), minutes: num(p.minutes, 30) })),
  );
  useConversationClientTool<Tools, "flag_crash_risk">("flag_crash_risk", (p) => {
    const level: CrashLevel = p.level === "high" || p.level === "moderate" ? p.level : "low";
    apply({ type: "flag_crash_risk", level, reason: String(p.reason ?? "") });
    return `Crash risk shown as ${level}. ${describe(dayRef.current)}`;
  });

  const startLive = async () => {
    setError(null);
    resetDay();
    setMode("connecting");
    try {
      const res = await fetch("/api/conversation-token", { cache: "no-store" });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) throw new Error(data.error ?? "Could not start a voice session.");
      // Ask for the mic up front so the permission prompt isn't racing the connection.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      conversation.startSession({ conversationToken: data.token, connectionType: "webrtc" });
    } catch (e) {
      setMode("idle");
      setError(e instanceof Error ? e.message : "Could not start a voice session.");
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
      setError(null);
      setMode("demo");
      try {
        await sleep(700 / speed, signal);
        for (const step of DEMO_SCRIPT) {
          if (step.kind === "pause") {
            await sleep(step.ms / speed, signal);
          } else if (step.kind === "tool") {
            apply(step.action);
            await sleep(420 / speed, signal);
          } else {
            const words = step.text.split(/\s+/).length;
            const total = speakMs(step.text, step.role) / speed;
            setSpeaker(step.role);
            apply({ type: "line", role: step.role, text: step.text });
            for (let w = 1; w <= words; w++) {
              setCaption({ role: step.role, text: step.text, words: w });
              await sleep(total / words, signal);
            }
            setSpeaker(null);
            await sleep(520 / speed, signal);
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

  const stopDemo = () => {
    abortRef.current?.abort();
    setMode("idle");
    resetDay();
  };

  /** ?demo=play autoplays, ?demo=end jumps to the final frame (screenshots, og image). */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const demo = params.get("demo");
    if (demo === "play") {
      const id = setTimeout(() => void runDemo({ speed: num(params.get("speed"), 1) }), 0);
      return () => clearTimeout(id);
    }
    if (demo === "end" || demo === "crash") {
      // "crash" freezes on the moment the crash warning appears; "end" on the final plan.
      const stopAt =
        demo === "crash"
          ? DEMO_SCRIPT.findIndex((s) => s.kind === "say" && s.text.includes("sneaks up"))
          : DEMO_SCRIPT.findLastIndex((s) => s.kind === "say" && s.text.includes("reserve"));
      const id = setTimeout(() => {
        DEMO_SCRIPT.slice(0, stopAt + 1).forEach((step) => {
          if (step.kind === "tool") apply(step.action);
        });
        const line = DEMO_SCRIPT[stopAt];
        if (line?.kind === "say") setCaption({ role: "agent", text: line.text, words: Infinity });
        setSpeaker("agent");
        setMode("demo-done");
      }, 0);
      return () => clearTimeout(id);
    }
  }, [apply, runDemo]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /* ---------------- Orb level ---------------- */

  const speaker = mode === "live" ? (conversation.isSpeaking ? "agent" : "user") : demoSpeaker;

  const getLevel = useCallback(() => {
    if (mode === "live") {
      try {
        return conversation.isSpeaking ? conversation.getOutputVolume() * 1.6 : conversation.getInputVolume() * 1.4;
      } catch {
        return 0;
      }
    }
    if (!speaker) return 0;
    const t = performance.now() / 1000;
    const syllables = Math.abs(Math.sin(t * 8.3) * Math.sin(t * 3.1 + 1));
    return speaker === "agent" ? 0.25 + syllables * 0.55 : 0.12 + syllables * 0.3;
  }, [mode, speaker, conversation]);

  const orbState: OrbState =
    mode === "connecting" ? "connecting" : speaker === "agent" ? "speaking" : speaker === "user" || mode === "live" ? "listening" : "idle";

  const busy = mode === "demo" || mode === "live" || mode === "connecting";
  const started = mode !== "idle";
  const warn = day.crash?.level === "high" || day.crash?.level === "moderate";

  const status =
    mode === "connecting"
      ? "Connecting"
      : mode === "live"
        ? conversation.isSpeaking
          ? "Speaking"
          : "Listening"
        : mode === "demo"
          ? "Demo · scripted"
          : mode === "demo-done"
            ? "Demo · scripted"
            : liveAvailable
              ? "ElevenLabs voice agent"
              : "Demo mode";

  const visibleCaption = caption
    ? caption.text
        .split(/\s+/)
        .slice(0, caption.words === Infinity ? undefined : caption.words)
        .join(" ")
    : null;

  return (
    <div className="grid w-full flex-1 grid-cols-1 items-center gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
      {/* Stage */}
      <section className="flex flex-col items-center text-center">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-xs text-white/50">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              mode === "live" ? "bg-[var(--color-rest)]" : busy ? "animate-pulse bg-white/70" : "bg-white/30"
            }`}
          />
          {status}
        </div>

        <div className="relative aspect-square w-full max-w-[300px] sm:max-w-[400px]">
          <Orb state={orbState} getLevel={getLevel} warn={warn} className="absolute inset-0 h-full w-full" />
        </div>

        <div className="flex min-h-[132px] w-full max-w-[520px] flex-col items-center justify-start sm:min-h-[150px]">
          <AnimatePresence mode="wait">
            {!started || !visibleCaption ? (
              <motion.h1
                key="headline"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="font-serif text-[38px] leading-[1.05] tracking-[-0.01em] text-white sm:text-[52px]"
              >
                How many spoons
                <br />
                <em className="text-white/55">do you have today?</em>
              </motion.h1>
            ) : (
              <motion.div
                key={caption!.text}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
                transition={{ duration: 0.3 }}
                className="flex flex-col items-center gap-2"
                aria-live="polite"
              >
                <span className="text-xs uppercase tracking-[0.16em] text-white/35">
                  {caption!.role === "agent" ? "Spoon Talk" : "You"}
                </span>
                <p
                  className={`font-serif text-[24px] leading-[1.25] sm:text-[30px] ${
                    caption!.role === "agent" ? "text-white" : "italic text-white/60"
                  }`}
                >
                  {visibleCaption}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex h-6 items-center justify-center">
          <AnimatePresence mode="wait">
            {lastTool && busy && (
              <motion.code
                key={lastTool.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="max-w-[90vw] truncate font-mono text-[11px] text-white/30"
              >
                <span className="text-[var(--color-rest)]/70">client tool</span> {lastTool.label}
              </motion.code>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-4 flex flex-col items-center gap-3">
          {busy ? (
            <button
              type="button"
              onClick={mode === "demo" ? stopDemo : () => conversation.endSession()}
              className="pill"
            >
              {mode === "demo" ? "Stop demo" : "End conversation"}
            </button>
          ) : liveAvailable ? (
            <>
              <button type="button" onClick={startLive} className="pill pill-primary">
                <MicIcon /> Start talking
              </button>
              <button type="button" onClick={() => runDemo()} className="text-sm text-white/45 transition hover:text-white/80">
                or watch the demo
              </button>
            </>
          ) : (
            <button type="button" onClick={() => runDemo()} className="pill pill-primary">
              <PlayIcon /> {mode === "demo-done" ? "Replay the demo" : "Play the demo"}
            </button>
          )}
          {error && <p className="max-w-xs text-sm text-[var(--color-warn)]">{error}</p>}
        </div>
      </section>

      {/* Plan */}
      <section aria-label="Today's spoon plan" className="glass rounded-[28px] p-5 sm:p-7">
        <DayPlan day={day} />
      </section>
    </div>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
      <path d="M7 4.8v14.4a1 1 0 0 0 1.5.9l11.2-7.2a1 1 0 0 0 0-1.7L8.5 3.9A1 1 0 0 0 7 4.8Z" />
    </svg>
  );
}

export function SpoonTalk({ liveAvailable }: { liveAvailable: boolean }) {
  return (
    <ConversationProvider>
      <SpoonTalkInner liveAvailable={liveAvailable} />
    </ConversationProvider>
  );
}
