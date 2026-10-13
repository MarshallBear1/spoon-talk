import { useId } from "react";

export const SPOON_PATH =
  "M12 2C17.6 2 20.6 7.2 20.6 13.2C20.6 18.6 17.4 22.4 13.4 23.8L14.2 52C14.3 56.5 13.4 60 12 60C10.6 60 9.7 56.5 9.8 52L10.6 23.8C6.6 22.4 3.4 18.6 3.4 13.2C3.4 7.2 6.4 2 12 2Z";

export type SpoonTone = "full" | "used" | "borrowed";

interface SpoonProps {
  /** 0..1 portion filled (left to right) for half spoons. */
  fill?: number;
  tone?: SpoonTone;
  className?: string;
  style?: React.CSSProperties;
}

/** A clean, hand-tuned spoon glyph. Filled spoons are polished; used ones are a quiet outline. */
export function Spoon({ fill = 1, tone = "full", className, style }: SpoonProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const outline =
    tone === "borrowed"
      ? "var(--color-warn)"
      : tone === "used" || fill < 1
        ? "rgba(255,255,255,0.16)"
        : "transparent";
  return (
    <svg viewBox="0 0 24 62" className={className} style={style} aria-hidden="true">
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFF8EE" />
          <stop offset="45%" stopColor="#E9DCCB" />
          <stop offset="100%" stopColor="#B8A894" />
        </linearGradient>
        <clipPath id={`c${id}`}>
          <rect x="0" y="0" width={24 * Math.max(0, Math.min(1, fill))} height="62" />
        </clipPath>
      </defs>
      <path
        d={SPOON_PATH}
        fill="none"
        stroke={outline}
        strokeWidth={1.2}
        strokeDasharray={tone === "borrowed" ? "2.5 2.5" : undefined}
      />
      {tone === "full" && fill > 0 && (
        <g clipPath={`url(#c${id})`}>
          <path d={SPOON_PATH} fill={`url(#g${id})`} />
          <ellipse cx="9.4" cy="10.5" rx="2.6" ry="5" fill="rgba(255,255,255,0.55)" />
        </g>
      )}
    </svg>
  );
}
