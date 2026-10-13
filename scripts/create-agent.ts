/**
 * Creates the Spoon Talk agent in your ElevenLabs workspace and prints its id.
 *
 *   ELEVENLABS_API_KEY=sk_... npm run create-agent
 *   npm run create-agent -- --dry-run      # print the payload, call nothing
 *
 * What it does:
 *   1. Creates one *client* tool per entry in src/lib/agent.ts (POST /v1/convai/tools).
 *      Client tools run in the browser, which is how the agent drives the UI.
 *   2. Creates a private agent (auth enabled) that uses those tools, the system
 *      prompt, first message and an ElevenLabs voice (POST /v1/convai/agents/create).
 *   3. Prints ELEVENLABS_AGENT_ID for your .env.local.
 *
 * Optional env: ELEVENLABS_VOICE_ID (default "Sarah"), ELEVENLABS_LLM (default gemini-2.5-flash).
 */
import { ElevenLabsClient, type ElevenLabs } from "@elevenlabs/elevenlabs-js";
import { AGENT_NAME, CLIENT_TOOLS, FIRST_MESSAGE, SYSTEM_PROMPT, toElevenLabsParameters } from "../src/lib/agent";

// "Sarah": a calm, warm premade voice available in every workspace.
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";
const DEFAULT_LLM: ElevenLabs.Llm = "gemini-2.5-flash";

const dryRun = process.argv.includes("--dry-run");

const toolRequests: ElevenLabs.ToolRequestModel[] = CLIENT_TOOLS.map((spec) => ({
  toolConfig: {
    type: "client",
    name: spec.name,
    description: spec.description,
    expectsResponse: true,
    responseTimeoutSecs: 10,
    parameters: toElevenLabsParameters(spec),
  },
}));

type CreateAgentRequest = Parameters<ElevenLabsClient["conversationalAi"]["agents"]["create"]>[0];

const agentRequest = (toolIds: string[]): CreateAgentRequest => ({
  name: AGENT_NAME,
  tags: ["spoon-talk", "juno"],
  conversationConfig: {
    agent: {
      firstMessage: FIRST_MESSAGE,
      language: "en",
      prompt: {
        prompt: SYSTEM_PROMPT,
        llm: (process.env.ELEVENLABS_LLM as ElevenLabs.Llm | undefined) ?? DEFAULT_LLM,
        temperature: 0.4,
        toolIds,
      },
    },
    tts: {
      // English-only agents use the low-latency Flash v2 model.
      modelId: "eleven_flash_v2",
      voiceId: process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID,
      stability: 0.55,
      similarityBoost: 0.8,
      speed: 0.95,
    },
  },
  platformSettings: {
    // Private agent: the browser can only join with a short-lived token minted by /api/conversation-token.
    auth: { enableAuth: true },
  },
});

async function main() {
  if (dryRun) {
    console.log(JSON.stringify({ tools: toolRequests, agent: agentRequest(["<tool ids>"]) }, null, 2));
    return;
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error("Missing ELEVENLABS_API_KEY. Put it in .env.local or export it, then run again.");
    process.exit(1);
  }

  const client = new ElevenLabsClient({ apiKey });

  const toolIds: string[] = [];
  for (const request of toolRequests) {
    const tool = await client.conversationalAi.tools.create(request);
    console.log(`  tool ${request.toolConfig.type === "client" ? request.toolConfig.name : ""} -> ${tool.id}`);
    toolIds.push(tool.id);
  }

  const { agentId } = await client.conversationalAi.agents.create(agentRequest(toolIds));

  console.log("\nSpoon Talk agent created.\n");
  console.log(`ELEVENLABS_AGENT_ID=${agentId}\n`);
  console.log("Add that line to .env.local (next to ELEVENLABS_API_KEY) and restart `npm run dev`.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
