import { chromium, serve } from "../tests/e2e/_harness.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT_DIR = path.join(ROOT, "artifacts", "phase6-validation");
const OPTIONAL_ARTIFACT_DIR = process.env.ARTIFACT_DIR || "C:\\Users\\user\\.gemini\\antigravity\\brain\\d3604c29-b57e-455f-b785-972eba43dedc";

// 確保 repo 內部輸出目錄獨立建立，無外部路徑依賴
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function verifyPng(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`File does not exist: ${filePath}`);
  const stat = fs.statSync(filePath);
  if (stat.size < 10000) throw new Error(`File too small (${stat.size} bytes): ${filePath}`);
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(8);
  fs.readSync(fd, buf, 0, 8, 0);
  fs.closeSync(fd);
  if (!buf.equals(PNG_MAGIC)) throw new Error(`Invalid PNG magic header: ${filePath}`);
  return stat.size;
}

async function capture() {
  const S = await serve();
  const browser = await (await chromium()).launch();
  const overflowResults = {};
  const pageErrors = [];

  const setupLogging = (page, contextName) => {
    page.on("pageerror", err => {
      console.error(`[Page Error - ${contextName}]`, err.message);
      pageErrors.push({ context: contextName, type: "pageerror", message: err.message });
    });
    page.on("console", msg => {
      if (msg.type() === "error") {
        console.error(`[Console Error - ${contextName}]`, msg.text());
        pageErrors.push({ context: contextName, type: "console.error", message: msg.text() });
      }
    });
  };

  try {
    console.log("Validation test server running at:", S.url);

    // 1. Mobile (390 x 844) - index.html Hero collapsed & expanded in Intel tab
    {
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true
      });
      const p = await ctx.newPage();
      setupLogging(p, "index-390");
      await p.goto(`${S.url}/learner/index.html`);
      await p.waitForTimeout(1000);

      // Switch to intel tab where Hero bar exists
      await p.evaluate(() => {
        if (typeof goTab === "function") goTab("intel");
      });
      await p.waitForTimeout(600);

      // 檢查文件級水平溢出
      const docOverflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      overflowResults["index-390-doc"] = docOverflow;

      // 01-index-390-hero-collapsed: 首頁簡介收合狀態
      const file1 = path.join(OUT_DIR, "01-index-390-hero-collapsed.png");
      await p.screenshot({ path: file1 });
      const sz1 = verifyPng(file1);
      console.log(`Saved & Verified: 01-index-390-hero-collapsed.png (${sz1} bytes)`);

      // 展開 Hero 抽屜
      await p.click("#heroBar");
      await p.waitForTimeout(600);
      const isExpanded = await p.evaluate(() => document.querySelector("#hero")?.classList.contains("open"));
      console.log("Hero drawer open state:", isExpanded);

      // 02-index-390-hero-expanded: 首頁簡介展開狀態
      const file2 = path.join(OUT_DIR, "02-index-390-hero-expanded.png");
      await p.screenshot({ path: file2 });
      const sz2 = verifyPng(file2);
      console.log(`Saved & Verified: 02-index-390-hero-expanded.png (${sz2} bytes)`);

      await ctx.close();
    }

    // 2. Mobile (390 x 844) - watch.html#daily (市場決策中心上、中、下段)
    {
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true
      });
      const p = await ctx.newPage();
      setupLogging(p, "hub-390");
      await p.goto(`${S.url}/learner/watch.html#daily`);
      await p.waitForTimeout(1200);

      await p.evaluate(() => {
        if (typeof setLt === "function") setLt("today");
      });
      await p.waitForTimeout(1000);

      // 水平溢出檢查
      const docOverflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      const cardOverflow = await p.evaluate(() => {
        const cards = document.querySelectorAll(".dh-card, .dh-core-card, .dh-factor, .dh-brief-summary");
        for (const c of cards) {
          if (c.scrollWidth > c.clientWidth + 1) return true;
        }
        return false;
      });
      overflowResults["hub-390-doc"] = docOverflow;
      overflowResults["hub-390-cards"] = cardOverflow;

      // 03-hub-390-top: 上段（核心行情卡片、早報決策結論、上漲動能與下跌風險）
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.waitForTimeout(400);
      const file3 = path.join(OUT_DIR, "03-hub-390-top.png");
      await p.screenshot({ path: file3 });
      const sz3 = verifyPng(file3);
      console.log(`Saved & Verified: 03-hub-390-top.png (${sz3} bytes)`);

      // 04-hub-390-mid: 中段（實盤驗證時間軸、收盤價、壓力／支撐觸及、成交量比較基準判定徽章）
      await p.evaluate(() => {
        const el = document.querySelector(".dh-card.val") || document.querySelectorAll(".dh-sec-wrap")[1];
        if (el) el.scrollIntoView({ block: "start", behavior: "instant" });
        else window.scrollTo(0, 480);
      });
      await p.waitForTimeout(400);
      const file4 = path.join(OUT_DIR, "04-hub-390-mid.png");
      await p.screenshot({ path: file4 });
      const sz4 = verifyPng(file4);
      console.log(`Saved & Verified: 04-hub-390-mid.png (${sz4} bytes)`);

      // 05-hub-390-bot: 下段（多因子雷達、客觀應對行動、頁尾資料來源宣告）
      await p.evaluate(() => {
        const el = document.querySelector(".dh-footer") || document.querySelectorAll(".dh-sec-wrap")[3];
        if (el) el.scrollIntoView({ block: "end", behavior: "instant" });
        else window.scrollTo(0, 1150);
      });
      await p.waitForTimeout(400);
      const file5 = path.join(OUT_DIR, "05-hub-390-bot.png");
      await p.screenshot({ path: file5 });
      const sz5 = verifyPng(file5);
      console.log(`Saved & Verified: 05-hub-390-bot.png (${sz5} bytes)`);

      await ctx.close();
    }

    // 3. Tablet (768 x 1024) - watch.html#daily (平板版雙欄佈局)
    {
      const ctx = await browser.newContext({
        viewport: { width: 768, height: 1024 }
      });
      const p = await ctx.newPage();
      setupLogging(p, "hub-768");
      await p.goto(`${S.url}/learner/watch.html#daily`);
      await p.waitForTimeout(1200);
      await p.evaluate(() => {
        if (typeof setLt === "function") setLt("today");
      });
      await p.waitForTimeout(1000);

      const docOverflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      overflowResults["hub-768-doc"] = docOverflow;

      const file6 = path.join(OUT_DIR, "06-hub-768-tablet.png");
      await p.screenshot({ path: file6 });
      const sz6 = verifyPng(file6);
      console.log(`Saved & Verified: 06-hub-768-tablet.png (${sz6} bytes)`);

      await ctx.close();
    }

    // 4. Desktop (1280 x 800) - watch.html#daily (桌面版正常驗證)
    {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 800 }
      });
      const p = await ctx.newPage();
      setupLogging(p, "hub-1280");
      await p.goto(`${S.url}/learner/watch.html#daily`);
      await p.waitForTimeout(1200);
      await p.evaluate(() => {
        if (typeof setLt === "function") setLt("today");
      });
      await p.waitForTimeout(1000);

      const docOverflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      overflowResults["hub-1280-doc"] = docOverflow;

      const file7 = path.join(OUT_DIR, "07-hub-1280-desktop.png");
      await p.screenshot({ path: file7 });
      const sz7 = verifyPng(file7);
      console.log(`Saved & Verified: 07-hub-1280-desktop.png (${sz7} bytes)`);

      // 5. Desktop (1280 x 800) - 缺失行情安全降級情境
      // 注入空白行情資料，驗證全域防禦降級：顯示「資料不足，暫不判定」與「資料暫缺」
      await p.evaluate(() => {
        if (typeof W !== "undefined") {
          W.bf = {};
          if (typeof renderList === "function") renderList();
          else if (typeof setLt === "function") setLt("today");
        }
      });
      await p.waitForTimeout(800);

      const file8 = path.join(OUT_DIR, "08-hub-1280-missing-data.png");
      await p.screenshot({ path: file8 });
      const sz8 = verifyPng(file8);
      console.log(`Saved & Verified: 08-hub-1280-missing-data.png (${sz8} bytes)`);

      await ctx.close();
    }

    console.log("\n=== 水平溢出驗證矩陣 ===");
    console.table(overflowResults);

    console.log("\n=== 瀏覽器控制台錯誤列表 ===");
    console.log(`Total page errors / console errors: ${pageErrors.length}`);
    if (pageErrors.length > 0) {
      console.table(pageErrors);
    }

    // 可選複製到對話 Artifact 目錄（若目錄存在且可寫）
    if (OPTIONAL_ARTIFACT_DIR && fs.existsSync(OPTIONAL_ARTIFACT_DIR)) {
      try {
        for (const f of fs.readdirSync(OUT_DIR)) {
          if (f.endsWith(".png")) {
            fs.copyFileSync(path.join(OUT_DIR, f), path.join(OPTIONAL_ARTIFACT_DIR, f));
          }
        }
        console.log(`Copied screenshots to chat artifact dir: ${OPTIONAL_ARTIFACT_DIR}`);
      } catch (copyErr) {
        console.warn(`Optional artifact copy skipped: ${copyErr.message}`);
      }
    }

  } finally {
    await browser.close();
    S.close();
  }
}

capture().catch(err => {
  console.error("Visual capture failed:", err);
  process.exit(1);
});
