/**
 * Captures README screenshots and the 1200x630 Open Graph image from demo mode.
 *
 *   npm run build && npm start      # in one terminal
 *   npm run screenshots             # in another (uses your installed Chrome)
 *
 * BASE_URL defaults to http://localhost:3000. og.png goes to public/, the rest to docs/.
 */
import { copyFileSync, readFileSync } from "node:fs";
import { chromium, type Browser, type ConsoleMessage } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? "docs";

/** Resize a PNG in the browser itself (no image tooling needed). */
async function downscale(browser: Browser, path: string, width: number, height: number) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const data = readFileSync(path).toString("base64");
  await page.setContent(
    `<html><body style="margin:0"><img src="data:image/png;base64,${data}" style="display:block;width:${width}px;height:${height}px"></body></html>`,
  );
  await page.waitForLoadState("load");
  await page.screenshot({ path });
  await page.close();
}

async function main() {
  // The ElevenLabs UI orb is WebGL: use the GPU on macOS, software SwiftShader elsewhere.
  const gl =
    process.platform === "darwin"
      ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"]
      : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: gl });
  const errors: string[] = [];
  const track = (m: ConsoleMessage) => {
    // SwiftShader (software WebGL in headless Chrome) logs driver perf notes; they are not app problems.
    if (m.text().includes("GL Driver Message")) return;
    if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`);
  };

  const shots: { name: string; url: string; width: number; height: number; wait: number; full?: boolean }[] = [
    // Rendered at 1500x788, then downscaled to the 1200x630 card so the whole frame fits.
    { name: "og.png", url: "/?demo=crash", width: 1500, height: 788, wait: 2500 },
    { name: "screenshot-desktop.png", url: "/?demo=end", width: 1440, height: 900, wait: 2500 },
    { name: "screenshot-crash.png", url: "/?demo=crash", width: 1440, height: 900, wait: 2500 },
    { name: "screenshot-idle.png", url: "/", width: 1440, height: 900, wait: 1500 },
    { name: "screenshot-mobile.png", url: "/?demo=crash", width: 375, height: 812, wait: 3000, full: true },
    { name: "screenshot-maths.png", url: "/?demo=end&maths=open", width: 1440, height: 900, wait: 3000, full: true },
    { name: "screenshot-mobile-idle.png", url: "/", width: 375, height: 812, wait: 1500 },
  ];

  for (const shot of shots) {
    const page = await browser.newPage({
      viewport: { width: shot.width, height: shot.height },
      deviceScaleFactor: shot.name === "og.png" ? 1 : 2,
    });
    page.on("console", track);
    page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
    await page.goto(BASE + shot.url, { waitUntil: "networkidle" });
    await page.waitForTimeout(shot.wait);
    if (shot.full) {
      // Number tickers animate when scrolled into view; walk the page so a full-page capture shows real values.
      const h = await page.evaluate(() => document.body.scrollHeight);
      for (let y = 0; y < h; y += shot.height / 2) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        await page.waitForTimeout(250);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(2500);
    }
    if (shot.name === "og.png") {
      // The OG card is the app itself, cropped to the hero so it reads at thumbnail size.
      await page.addStyleTag({ content: "footer{display:none!important} main{padding-top:0!important}" });
      await page.waitForTimeout(300);
    }
    const path = shot.name === "og.png" ? "public/og.png" : `${OUT}/${shot.name}`;
    await page.screenshot({ path, fullPage: shot.full ?? false });
    if (shot.name === "og.png") {
      await downscale(browser, path, 1200, 630);
      copyFileSync(path, "showcase-submission/projects/images/spoon-talk.png");
    }
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
