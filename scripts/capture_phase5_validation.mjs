import { chromium, serve } from "../tests/e2e/_harness.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT_DIR = path.join(ROOT, "artifacts", "phase5-validation");
const ARTIFACT_DIR = "C:\\Users\\user\\.gemini\\antigravity\\brain\\d3604c29-b57e-455f-b785-972eba43dedc";

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

async function capture() {
  const S = await serve();
  const browser = await (await chromium()).launch();
  const overflowResults = {};

  try {
    console.log("Server running at:", S.url);

    // 1. Mobile (390 x 844) - index.html Hero collapsed & expanded in Intel tab
    {
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true
      });
      const p = await ctx.newPage();
      await p.goto(`${S.url}/learner/index.html`);
      await p.waitForTimeout(1000);

      // Switch to intel tab where Hero is active
      await p.evaluate(() => {
        if (typeof goTab === "function") goTab("intel");
      });
      await p.waitForTimeout(600);

      // Check overflow
      const ov = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      overflowResults["index-390"] = ov;

      // 01-index-390-hero-collapsed: Mobile default collapsed hero bar
      const file1 = path.join(OUT_DIR, "01-index-390-hero-collapsed.png");
      await p.screenshot({ path: file1 });
      console.log("Saved:", file1);

      // Expand hero drawer by clicking #heroBar
      await p.click("#heroBar");
      await p.waitForTimeout(600);
      const isExpanded = await p.evaluate(() => document.querySelector("#hero")?.classList.contains("open"));
      console.log("Hero expanded state:", isExpanded);

      // 02-index-390-hero-expanded: Mobile expanded hero drawer
      const file2 = path.join(OUT_DIR, "02-index-390-hero-expanded.png");
      await p.screenshot({ path: file2 });
      console.log("Saved:", file2);

      await ctx.close();
    }

    // 2. Mobile (390 x 844) - watch.html#daily (Market Decision Hub)
    {
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true
      });
      const p = await ctx.newPage();
      await p.goto(`${S.url}/learner/watch.html#daily`);
      await p.waitForTimeout(1200);

      await p.evaluate(() => {
        if (typeof setLt === "function") setLt("today");
      });
      await p.waitForTimeout(1000);

      const ov = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      overflowResults["hub-390"] = ov;

      // 03-hub-390-top: Top of Market Decision Hub (Core Cards & Summary Box)
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.waitForTimeout(400);
      const file3 = path.join(OUT_DIR, "03-hub-390-top.png");
      await p.screenshot({ path: file3 });
      console.log("Saved:", file3);

      // 04-hub-390-mid: Middle section (Verification timeline with volume validation + scenarios)
      await p.evaluate(() => {
        const el = document.querySelector(".dh-card.val") || document.querySelectorAll(".dh-sec-wrap")[1];
        if (el) el.scrollIntoView({ block: "start", behavior: "instant" });
        else window.scrollTo(0, 450);
      });
      await p.waitForTimeout(400);
      const file4 = path.join(OUT_DIR, "04-hub-390-mid.png");
      await p.screenshot({ path: file4 });
      console.log("Saved:", file4);

      // 05-hub-390-bot: Bottom section (Radar, Actions, Footer)
      await p.evaluate(() => {
        const el = document.querySelector(".dh-footer") || document.querySelectorAll(".dh-sec-wrap")[3];
        if (el) el.scrollIntoView({ block: "end", behavior: "instant" });
        else window.scrollTo(0, 1100);
      });
      await p.waitForTimeout(400);
      const file5 = path.join(OUT_DIR, "05-hub-390-bot.png");
      await p.screenshot({ path: file5 });
      console.log("Saved:", file5);

      await ctx.close();
    }

    // 3. Tablet (768 x 1024) - watch.html#daily
    {
      const ctx = await browser.newContext({
        viewport: { width: 768, height: 1024 }
      });
      const p = await ctx.newPage();
      await p.goto(`${S.url}/learner/watch.html#daily`);
      await p.waitForTimeout(1200);
      await p.evaluate(() => {
        if (typeof setLt === "function") setLt("today");
      });
      await p.waitForTimeout(1000);

      const ov = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      overflowResults["hub-768"] = ov;

      const file6 = path.join(OUT_DIR, "06-hub-768-tablet.png");
      await p.screenshot({ path: file6 });
      console.log("Saved:", file6);

      await ctx.close();
    }

    // 4. Desktop (1280 x 800) - watch.html#daily (Normal full verified state)
    {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 800 }
      });
      const p = await ctx.newPage();
      await p.goto(`${S.url}/learner/watch.html#daily`);
      await p.waitForTimeout(1200);
      await p.evaluate(() => {
        if (typeof setLt === "function") setLt("today");
      });
      await p.waitForTimeout(1000);

      const ov = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      overflowResults["hub-1280"] = ov;

      const file7 = path.join(OUT_DIR, "07-hub-1280-desktop.png");
      await p.screenshot({ path: file7 });
      console.log("Saved:", file7);

      // 5. Desktop (1280 x 800) - Missing Data Scenario
      // Inject missing macro data to verify safe fallback: "資料不足，暫不判定" and "資料暫缺"
      await p.evaluate(() => {
        if (typeof W !== "undefined") {
          W.bf = {}; // Empty global macro data
          if (typeof renderList === "function") renderList();
          else if (typeof setLt === "function") setLt("today");
        }
      });
      await p.waitForTimeout(800);

      const file8 = path.join(OUT_DIR, "08-hub-1280-missing-data.png");
      await p.screenshot({ path: file8 });
      console.log("Saved:", file8);

      await ctx.close();
    }

    console.log("Horizontal overflow verification results:");
    console.table(overflowResults);

    // Copy all generated files to ARTIFACT_DIR for direct artifact access
    for (const f of fs.readdirSync(OUT_DIR)) {
      if (f.endsWith(".png")) {
        fs.copyFileSync(path.join(OUT_DIR, f), path.join(ARTIFACT_DIR, f));
      }
    }
    console.log("Copied all screenshots to artifacts directory.");

  } finally {
    await browser.close();
    S.close();
  }
}

capture().catch(err => {
  console.error("Capture error:", err);
  process.exit(1);
});
