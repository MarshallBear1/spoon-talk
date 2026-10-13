import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Mints a short-lived WebRTC conversation token for the private Spoon Talk agent.
 * ELEVENLABS_API_KEY never leaves the server; the browser only ever sees the token.
 */
export const dynamic = "force-dynamic";

// Tiny best-effort limiter so a public demo can't be used to burn credits.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 6;
const hits = new Map<string, number[]>();

const limited = (key: string) => {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5_000) hits.clear();
  return recent.length > MAX_PER_WINDOW;
};

export async function GET(request: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;

  if (!apiKey || !agentId) {
    return NextResponse.json(
      { error: "Live voice is not configured. Set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID." },
      { status: 503 },
    );
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (limited(ip)) {
    return NextResponse.json({ error: "Too many sessions. Try again in a minute." }, { status: 429 });
  }

  try {
    const client = new ElevenLabsClient({ apiKey });
    const { token } = await client.conversationalAi.conversations.getWebrtcToken({ agentId });
    return NextResponse.json({ token }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[conversation-token]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not start a voice session." }, { status: 502 });
  }
}
