/**
 * Captures README screenshots and the 1200x630 Open Graph image from demo mode.
 *
 *   npm run build && npm start      # in one terminal
 *   npm run screenshots             # in another (uses your installed Chrome)
 *
 * BASE_URL defaults to http://localhost:3000. og.png goes to public/, the rest to docs/.
 */
import { chromium, type ConsoleMessage } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? "docs";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const errors: string[] = [];
  const track = (m: ConsoleMessage) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`);
  };

  const shots: { name: string; url: string; width: number; height: number; wait: number; full?: boolean }[] = [
    // Rendered at 1500x788 and scaled 0.8 so the whole hero fits the 1200x630 card.
    { name: "og.png", url: "/?demo=crash", width: 1500, height: 788, wait: 2500 },
    { name: "screenshot-desktop.png", url: "/?demo=end", width: 1440, height: 900, wait: 2500 },
    { name: "screenshot-crash.png", url: "/?demo=crash", width: 1440, height: 900, wait: 2500 },
    { name: "screenshot-idle.png", url: "/", width: 1440, height: 900, wait: 1500 },
    { name: "screenshot-mobile.png", url: "/?demo=end", width: 375, height: 812, wait: 2500, full: true },
    { name: "screenshot-mobile-idle.png", url: "/", width: 375, height: 812, wait: 1500 },
  ];

  for (const shot of shots) {
    const page = await browser.newPage({
      viewport: { width: shot.width, height: shot.height },
      deviceScaleFactor: shot.name === "og.png" ? 0.8 : 2,
    });
    page.on("console", track);
    page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
    await page.goto(BASE + shot.url, { waitUntil: "networkidle" });
    await page.waitForTimeout(shot.wait);
    if (shot.name === "og.png") {
      // The OG card is the app itself, cropped to the hero so it reads at thumbnail size.
      await page.addStyleTag({ content: "footer{display:none!important} main{padding-top:0!important}" });
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: shot.name === "og.png" ? "public/og.png" : `${OUT}/${shot.name}`, fullPage: shot.full ?? false });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    console.log(`${shot.name.padEnd(28)} ${shot.width}x${shot.height}  horizontal overflow: ${overflow}px`);
    await page.close();
  }

  // Watch the scripted demo play through at 4x speed and make sure nothing logs an error.
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("console", track);
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(`${BASE}/?demo=play&speed=4`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Replay the demo/ }).waitFor({ timeout: 60_000 });
  const left = await page.locator("text=Spoons left").locator("xpath=..").innerText();
  console.log(`demo playback finished: ${left.replace(/\s+/g, " ")}`);
  await page.close();

  await browser.close();
  if (errors.length) {
    console.error(`\n${errors.length} console problem(s):\n${errors.join("\n")}`);
    process.exit(1);
  }
  console.log("\nNo console errors or warnings.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
