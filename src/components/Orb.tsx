"use client";

import { useEffect, useRef } from "react";

export type OrbState = "idle" | "connecting" | "listening" | "speaking";

interface OrbProps {
  state: OrbState;
  /** 0..1 audio level, read every frame (live: SDK output/input volume; demo: synthetic). */
  getLevel?: () => number;
  /** Warm the orb up when a crash risk is flagged. */
  warn?: boolean;
  className?: string;
}

type RGB = [number, number, number];

const CALM: RGB[] = [
  [124, 108, 242], // violet
  [79, 209, 197], // aqua
  [246, 165, 139], // peach
];
const WARM: RGB[] = [
  [246, 140, 102],
  [124, 108, 242],
  [252, 196, 120],
];

const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a})`;

/**
 * A soft, audio-reactive voice orb drawn on a 2D canvas: three deformed blobs
 * blended with `screen`, breathing at rest and rippling with the voice level.
 */
export function Orb({ state, getLevel, warn = false, className }: OrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const levelRef = useRef(getLevel);
  const warnRef = useRef(warn);

  useEffect(() => {
    stateRef.current = state;
    levelRef.current = getLevel;
    warnRef.current = warn;
  }, [state, getLevel, warn]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let level = 0;
    let warmth = warnRef.current ? 1 : 0;
    let energy = 0;
    const start = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const blob = (cx: number, cy: number, r: number, t: number, seed: number, amp: number) => {
      ctx.beginPath();
      const steps = 96;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const d =
          1 +
          amp *
            (0.55 * Math.sin(3 * a + t * 1.1 + seed) +
              0.3 * Math.sin(5 * a - t * 1.7 + seed * 2) +
              0.15 * Math.sin(7 * a + t * 2.3 + seed * 3));
        const x = cx + Math.cos(a) * r * d;
        const y = cy + Math.sin(a) * r * d;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };

    const frame = (now: number) => {
      const t = ((now - start) / 1000) * (reduced ? 0.25 : 1);
      const s = stateRef.current;
      const target = Math.min(1, Math.max(0, levelRef.current?.() ?? 0));
      level += (target - level) * 0.18;
      warmth += ((warnRef.current ? 1 : 0) - warmth) * 0.03;
      const activeTarget = s === "speaking" ? 1 : s === "listening" ? 0.55 : s === "connecting" ? 0.35 : 0.15;
      energy += (activeTarget - energy) * 0.05;

      const { width, height } = canvas.getBoundingClientRect();
      const cx = width / 2;
      const cy = height / 2;
      const base = Math.min(width, height) * 0.3;
      const breathe = 1 + Math.sin(t * 1.2) * 0.02 + (s === "connecting" ? Math.sin(t * 5) * 0.025 : 0);
      const r = base * breathe * (1 + level * 0.12);

      ctx.clearRect(0, 0, width, height);

      const palette = CALM.map((c, i) => mix(c, WARM[i], warmth));

      // Halo
      const haloR = Math.min(width, height) * 0.5;
      const halo = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, haloR);
      halo.addColorStop(0, rgba(palette[0], 0.22 + level * 0.15));
      halo.addColorStop(0.5, rgba(palette[1], 0.06 + level * 0.06));
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const amp = 0.03 + energy * 0.03 + level * 0.09;
      palette.forEach((color, i) => {
        const orbit = r * (0.08 + level * 0.06);
        const ox = Math.cos(t * (0.5 + i * 0.17) + i * 2.1) * orbit;
        const oy = Math.sin(t * (0.6 + i * 0.13) + i * 1.3) * orbit;
        const g = ctx.createRadialGradient(cx + ox - r * 0.3, cy + oy - r * 0.35, r * 0.05, cx + ox, cy + oy, r * 1.15);
        g.addColorStop(0, rgba(mix(color, [255, 255, 255], 0.25), 0.8));
        g.addColorStop(0.6, rgba(color, 0.55));
        g.addColorStop(1, rgba(color, 0.04));
        ctx.fillStyle = g;
        blob(cx + ox, cy + oy, r * (0.92 - i * 0.06), t * (0.8 + i * 0.25), i * 1.7, amp);
        ctx.fill();
      });
      ctx.restore();

      // Glassy highlight
      const hl = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.45, 0, cx - r * 0.35, cy - r * 0.45, r * 0.9);
      hl.addColorStop(0, "rgba(255,255,255,0.22)");
      hl.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = hl;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.95, 0, Math.PI * 2);
      ctx.fill();

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
