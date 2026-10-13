import { SpoonTalk } from "@/components/SpoonTalk";

export const dynamic = "force-dynamic";

const JUNO = "https://junocompanion.com";
const SPOON_THEORY = "https://junocompanion.com/blog/pacing-and-energy/spoon-theory";
const WHITE_PAPER = "https://junocompanion.com/juno_pacing_whitepaper.pdf";
const PEM = "https://junocompanion.com/blog/pacing-and-energy/delayed-post-exertional-malaise-how-to-spot-your-pem-window";

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8b7cf6" />
          <stop offset="55%" stopColor="#4fd1c5" />
          <stop offset="100%" stopColor="#f6a58b" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="url(#logo-g)" opacity="0.9" />
      <path
        d="M16 6.5c2.7 0 4.2 2.4 4.2 5.2 0 2.5-1.5 4.2-3.3 4.9l.4 7.9c0 1.3-.5 2.3-1.3 2.3s-1.3-1-1.3-2.3l.4-7.9c-1.8-.7-3.3-2.4-3.3-4.9 0-2.8 1.5-5.2 4.2-5.2Z"
        fill="#0b0b0f"
        opacity="0.85"
      />
    </svg>
  );
}

export default function Home() {
  const liveAvailable = Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_AGENT_ID);

  return (
    <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[1200px] flex-col overflow-x-clip px-4 sm:px-8">
      <header className="flex items-center justify-between py-5">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="text-[15px] font-medium tracking-tight text-white/90">Spoon Talk</span>
        </div>
        <a
          href={JUNO}
          className="group inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] px-3.5 py-1.5 text-[13px] text-white/60 transition hover:border-white/20 hover:text-white"
        >
          Made by <span className="font-medium text-white/90">Juno</span>
          <span aria-hidden="true" className="transition group-hover:translate-x-0.5">↗</span>
        </a>
      </header>

      <main className="flex flex-1 flex-col pt-6 pb-10 sm:pt-10">
        <SpoonTalk liveAvailable={liveAvailable} />
      </main>

      <footer className="flex flex-col gap-3 border-t border-white/[0.06] py-6 text-[13px] text-white/40 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex flex-wrap gap-x-5 gap-y-2">
          <a href={SPOON_THEORY} className="text-white/60 transition hover:text-white">
            What is spoon theory?
          </a>
          <a href={PEM} className="transition hover:text-white">
            Why crashes come late
          </a>
          <a href={WHITE_PAPER} className="transition hover:text-white">
            Juno pacing white paper
          </a>
          <a href={JUNO} className="transition hover:text-white">
            Made by Juno
          </a>
        </nav>
        <p className="max-w-md leading-5">
          The model is inspired by Juno&apos;s pacing white paper (a development prototype, not clinically validated).
          Coefficients are illustrative. Not medical advice.
        </p>
      </footer>
    </div>
  );
}
