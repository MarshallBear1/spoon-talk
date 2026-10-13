# Spoon Talk

**Plan your day in spoons, out loud.** Tell a voice agent what today looks like. It asks how you slept and how much energy you have, prices each activity in spoons, adds rest and warns you when tomorrow's crash is building. The screen updates live while you talk.

Built on [ElevenLabs Agents](https://elevenlabs.io/docs/eleven-agents/overview) with **client tools**, so the voice drives the UI. Made by [Juno](https://junocompanion.com), the companion app for people living with chronic illness.

![Spoon Talk: the voice orb on the left, today's spoon plan on the right](docs/screenshot-desktop.png)

> **Live demo:** TODO: add the Vercel URL here
>
> Works with no API keys: open the page and press **Play the demo** for a scripted conversation that drives the exact same UI.

## What it does

You say: *"I've got a GP appointment at eleven, I need a shower, and I really want to cook tonight."*

Spoon Talk:

1. Asks how you slept and your energy out of ten, then fills the day's **spoon budget** (energy × 2.4).
2. Prices each activity, including the hidden costs (travel, waiting rooms, standing), and drops it into morning, afternoon or evening.
3. Adds **rest blocks** after big activities. A rest gives spoons back.
4. Flags a **next-day crash risk** when the plan runs close to empty. Post-exertional malaise is often delayed by [24 to 48 hours](https://junocompanion.com/blog/pacing-and-energy/delayed-post-exertional-malaise-how-to-spot-your-pem-window), so feeling fine today isn't the whole story.
5. Offers one trade-off ("could dinner be one pan?") and re-prices the plan when you agree.

New to spoons? Read [What is spoon theory?](https://junocompanion.com/blog/pacing-and-energy/spoon-theory) on the Juno blog.

| Crash warning | Mobile |
| --- | --- |
| ![Crash risk flagged](docs/screenshot-crash.png) | ![Mobile layout](docs/screenshot-mobile.png) |

## How it uses ElevenLabs

| Piece | ElevenLabs feature |
| --- | --- |
| The conversation | An **ElevenLabs Agent** (Conversational AI): speech recognition, LLM, turn-taking and interruptions |
| The voice | **ElevenLabs TTS** (`eleven_flash_v2`, the "Sarah" voice by default) |
| The live UI | **Client tools**: the agent calls functions that run in the browser |
| The connection | `@elevenlabs/react` `useConversation` over **WebRTC**, using a short-lived conversation token |
| Privacy of the key | A **private agent** (auth enabled). The server mints a token with `ELEVENLABS_API_KEY`, and the key never reaches the browser |

### Client tools

Defined once in [`src/lib/agent.ts`](src/lib/agent.ts), registered with the agent by the create script and handled in the browser with `useConversationClientTool`:

| Tool | Parameters | On screen |
| --- | --- | --- |
| `set_energy` | `level` 0–10, `sleep_hours?` | Fills the spoon budget |
| `add_activity` | `name`, `spoons`, `when`, `note?` | Adds a card (or re-prices it, if the name already exists) |
| `remove_activity` | `name` | Removes a card |
| `suggest_rest` | `after`, `minutes` | Puts a rest block after an activity (+1 spoon for 30+ min) |
| `flag_crash_risk` | `level` low/moderate/high, `reason` | Shows the next-day warning and warms the orb |

Every tool returns the live totals as text (for example `Budget 10 spoons… Used 7.5. 2.5 spoons left…`). The agent always speaks the real numbers and never does the maths in its head.

```tsx
useConversationClientTool<Tools, "add_activity">("add_activity", (p) =>
  describe(apply({ type: "add_activity", name: String(p.name), spoons: num(p.spoons, 1), when: toSlot(p.when) })),
);
```

The live agent and the scripted demo both send actions to one pure reducer ([`src/lib/spoons.ts`](src/lib/spoons.ts)), so the demo looks exactly like a real call.

## Setup

Requires Node 20.6+.

```bash
git clone TODO-repo-url spoon-talk && cd spoon-talk
npm install
npm run dev            # http://localhost:3000. Demo mode works straight away
```

### Turn on the live voice agent

1. Get an API key at [elevenlabs.io](https://elevenlabs.io/app/settings/api-keys). It needs the Conversational AI (agents) permissions.
2. Create the agent (its 5 client tools, system prompt, first message and voice):

   ```bash
   cp .env.example .env.local
   # put ELEVENLABS_API_KEY=... in .env.local
   npm run create-agent              # prints ELEVENLABS_AGENT_ID=agent_...
   npm run create-agent -- --dry-run # or just print the payload
   ```

3. Add `ELEVENLABS_AGENT_ID` to `.env.local` and restart `npm run dev`. The button now reads **Start talking**.

### Environment variables

| Name | Required | Notes |
| --- | --- | --- |
| `ELEVENLABS_API_KEY` | for live mode | Server only. Used by `/api/conversation-token` and `create-agent` |
| `ELEVENLABS_AGENT_ID` | for live mode | From `npm run create-agent` |
| `ELEVENLABS_VOICE_ID` | no | Voice used by `create-agent` (default `EXAVITQu4vr4xnSDxMaL`, "Sarah") |
| `ELEVENLABS_LLM` | no | LLM used by `create-agent` (default `gemini-2.5-flash`) |
| `NEXT_PUBLIC_SITE_URL` | no | Absolute URL for Open Graph tags |

If either of the first two is missing, the app runs in demo mode.

### Deploy

Any Next.js host works. On Vercel: import the repo and set the env vars above. `/api/conversation-token` has a small rate limit per IP (6 sessions a minute) so a public demo can't be used to burn your credits.

## Project layout

```
src/app/page.tsx                     page shell, header/footer links
src/app/api/conversation-token/      mints a WebRTC conversation token (server)
src/components/SpoonTalk.tsx         useConversation + client tools + demo player
src/components/Orb.tsx               audio-reactive canvas orb
src/components/DayPlan.tsx           spoon meter, crash card, day timeline
src/components/Spoon.tsx             the spoon glyph (SVG)
src/lib/spoons.ts                    budget model + reducer (pure)
src/lib/agent.ts                     system prompt, first message, tool schemas
src/lib/demo-script.ts               scripted demo conversation
scripts/create-agent.ts              creates the tools + private agent via the ElevenLabs API
scripts/screenshots.ts               README screenshots + public/og.png (Playwright + Chrome)
```

URL flags for demos and screenshots: `/?demo=play` autoplays (`&speed=2` for faster), `/?demo=crash` freezes on the crash warning, `/?demo=end` freezes on the final plan.

## The spoon model

`budget = round(energy × k)` with `k = 2.4`. Rests of 30 minutes or more give 1 spoon back, shorter rests give ½. Going over budget shows dashed "borrowed from tomorrow" spoons.

The 2.4 starting rule is **inspired by** Juno's technical white paper, [*Personalized pacing with Juno*](https://junocompanion.com/juno_pacing_whitepaper.pdf). That paper describes a development prototype. **It is not clinically validated**, and Spoon Talk uses only its simplest rule.

## Not medical advice

Spoon Talk is a planning aid, not a medical device. It does not diagnose, treat or replace your clinician. If something feels new, severe or worrying, contact your doctor or emergency services.

## Credits

Built by **[Juno](https://junocompanion.com)**, a companion app for people living with chronic illness. Voice and conversation by [ElevenLabs](https://elevenlabs.io). Spoon theory was created by Christine Miserandino.

MIT licensed. See [LICENSE](LICENSE).
