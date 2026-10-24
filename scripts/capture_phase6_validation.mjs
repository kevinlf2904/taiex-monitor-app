import { chromium, serve, mock } from "../tests/e2e/_harness.mjs";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT_DIR = path.join(ROOT, "artifacts", "phase6-validation");
const OPTIONAL_ARTIFACT_DIR = process.env.ARTIFACT_DIR || null;

// 確保 repo 內部輸出目錄獨立建立，無外部路徑依賴
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// IEEE 802.3 CRC32 快速對照表
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    c = CRC32_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function decodeAndVerifyPng(filePath, expectedWidth, expectedHeight) {
  if (!fs.existsSync(filePath)) throw new Error(`[PNG Error] File does not exist: ${filePath}`);
  const buf = fs.readFileSync(filePath);
  if (buf.length < 10000) throw new Error(`[PNG Error] File too small (${buf.length} bytes): ${filePath}`);

  // 1. 驗證 PNG 8-byte 魔術標頭
  if (!buf.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new Error(`[PNG Error] Invalid PNG magic header in ${filePath}`);
  }

  // 2. 驗證 IHDR 區塊並解析真實像素尺寸與色彩格式
  const ihdrLen = buf.readUInt32BE(8);
  const ihdrType = buf.toString("ascii", 12, 16);
  if (ihdrType !== "IHDR" || ihdrLen !== 13) {
    throw new Error(`[PNG Error] Missing or invalid IHDR chunk in ${filePath}`);
  }

  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];

  if (expectedWidth && width !== expectedWidth) {
    throw new Error(`[PNG Error] Width mismatch in ${filePath}: expected ${expectedWidth}px, got ${width}px`);
  }
  if (expectedHeight && height !== expectedHeight) {
    throw new Error(`[PNG Error] Height mismatch in ${filePath}: expected ${expectedHeight}px, got ${height}px`);
  }

  // 3. 遍歷所有 Chunk：驗證邊界、每個 Chunk 的 CRC32、收集 IDAT 並確認 IEND 結束
  let offset = 8;
  const idatBuffers = [];
  let hasIend = false;

  while (offset < buf.length) {
    if (offset + 8 > buf.length) throw new Error(`[PNG Error] Unexpected EOF while reading chunk header in ${filePath}`);
    const chunkLen = buf.readUInt32BE(offset);
    const chunkType = buf.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLen;
    if (dataEnd + 4 > buf.length) throw new Error(`[PNG Error] Chunk ${chunkType} truncated in ${filePath}`);

    // CRC 驗證：PNG CRC32 計算範圍為 Chunk Type + Chunk Data
    const chunkPayload = buf.subarray(offset + 4, dataEnd);
    const expectedCrc = buf.readUInt32BE(dataEnd);
    const actualCrc = crc32(chunkPayload);
    if (expectedCrc !== actualCrc) {
      throw new Error(`[PNG Error] CRC32 mismatch in chunk ${chunkType} of ${filePath}: expected 0x${expectedCrc.toString(16)}, got 0x${actualCrc.toString(16)}`);
    }

    if (chunkType === "IDAT") {
      idatBuffers.push(buf.subarray(dataStart, dataEnd));
    } else if (chunkType === "IEND") {
      hasIend = true;
      offset = dataEnd + 4;
      break;
    }
    offset = dataEnd + 4; // skip CRC
  }

  if (!hasIend) throw new Error(`[PNG Error] Missing IEND chunk in ${filePath}`);
  if (offset !== buf.length) throw new Error(`[PNG Error] Trailing garbage after IEND chunk in ${filePath} (offset ${offset} vs file size ${buf.length})`);
  if (idatBuffers.length === 0) throw new Error(`[PNG Error] Missing IDAT chunk in ${filePath}`);

  // 4. 使用 zlib 解碼 IDAT 串流，確認圖檔完整可解碼，並斷言解壓縮後的像素 raw scanline 長度完全相符
  const combinedIdat = Buffer.concat(idatBuffers);
  const decompressed = zlib.inflateSync(combinedIdat);
  if (!decompressed || decompressed.length === 0) {
    throw new Error(`[PNG Error] Failed to decode/inflate IDAT compressed payload in ${filePath}`);
  }

  // PNG scanline: 每一列包含 1 個 filter byte，加上 width * bytesPerPixel
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const bytesPerPixel = channels * (bitDepth / 8);
  const expectedDecompressedBytes = height * (1 + width * bytesPerPixel);

  if (decompressed.length !== expectedDecompressedBytes) {
    throw new Error(`[PNG Error] Decompressed scanline length mismatch in ${filePath}: expected ${expectedDecompressedBytes} bytes, got ${decompressed.length} bytes`);
  }

  return { width, height, size: buf.length, decompressedBytes: decompressed.length, bitDepth, colorType };
}

async function verifyBrowserDecoding(p, filePath, expectedWidth, expectedHeight) {
  const buf = fs.readFileSync(filePath);
  const base64 = buf.toString("base64");
  const dataUrl = `data:image/png;base64,${base64}`;
  const decoded = await p.evaluate(async (src) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, complete: img.complete });
      img.onerror = (e) => reject(new Error("Browser engine failed to decode image: " + e));
      img.src = src;
    });
  }, dataUrl);

  if (!decoded.complete || decoded.naturalWidth !== expectedWidth || decoded.naturalHeight !== expectedHeight) {
    throw new Error(`[Browser Decode Failure] Image ${filePath} failed browser decoding: expected ${expectedWidth}x${expectedHeight}, got ${JSON.stringify(decoded)}`);
  }
  return decoded;
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

  const createContext = async (options = {}) => {
    const ctx = await browser.newContext({
      serviceWorkers: "block",
      ...options
    });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem("kline:watch:onbOff", "true");
      } catch {}
    });
    await mock(ctx);
    return ctx;
  };

  const assertNoOverflow = async (p, contextName) => {
    const docOverflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    const cardOverflow = await p.evaluate(() => {
      const elements = document.querySelectorAll(".dh-card, .dh-core-card, .dh-factor, .dh-brief-summary, .dh-sec-wrap, .hero, .hero-bar");
      for (const el of elements) {
        if (el.scrollWidth > el.clientWidth + 1) return true;
      }
      return false;
    });
    overflowResults[`${contextName}-doc`] = docOverflow;
    overflowResults[`${contextName}-cards`] = cardOverflow;
    if (docOverflow) {
      throw new Error(`[Assertion Failure] Document horizontal overflow detected in ${contextName}`);
    }
    if (cardOverflow) {
      throw new Error(`[Assertion Failure] Card/element horizontal overflow detected in ${contextName}`);
    }
  };

  try {
    console.log("Validation test server running at:", S.url);

    // 1. Mobile (390 x 844) - index.html Hero collapsed & expanded in Intel tab
    {
      const ctx = await createContext({
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

      // 嚴格斷言收合狀態：手機版預設必須為收合
      const initialOpen = await p.evaluate(() => {
        const el = document.querySelector("#hero");
        const bar = document.querySelector("#heroBar");
        return {
          hasOpenClass: el?.classList.contains("open") || false,
          ariaExpanded: bar?.getAttribute("aria-expanded")
        };
      });
      if (initialOpen.hasOpenClass !== false || initialOpen.ariaExpanded === "true") {
        throw new Error(`[Assertion Failure] Hero drawer must be collapsed initially on mobile, but got: ${JSON.stringify(initialOpen)}`);
      }

      // 檢查收合狀態水平與卡片溢出
      await assertNoOverflow(p, "index-390-collapsed");

      // 01-index-390-hero-collapsed: 首頁簡介收合狀態
      const file1 = path.join(OUT_DIR, "01-index-390-hero-collapsed.png");
      await p.screenshot({ path: file1 });
      const info1 = decodeAndVerifyPng(file1, 390, 844);
      await verifyBrowserDecoding(p, file1, 390, 844);
      console.log(`Saved, Decoded & Verified: 01-index-390-hero-collapsed.png (${info1.width}x${info1.height}, ${info1.size} bytes)`);

      // 點擊展開 Hero 抽屜
      await p.click("#heroBar");
      await p.waitForTimeout(600);

      // 嚴格斷言展開狀態：點擊後必須帶有 open 樣式類且 aria-expanded 為 true
      const afterOpen = await p.evaluate(() => {
        const el = document.querySelector("#hero");
        const bar = document.querySelector("#heroBar");
        const toggle = document.querySelector("#heroToggleText");
        return {
          hasOpenClass: el?.classList.contains("open") || false,
          ariaExpanded: bar?.getAttribute("aria-expanded"),
          toggleText: toggle?.textContent?.trim()
        };
      });
      if (afterOpen.hasOpenClass !== true || afterOpen.ariaExpanded !== "true") {
        throw new Error(`[Assertion Failure] Hero drawer must be open after click, but got: ${JSON.stringify(afterOpen)}`);
      }

      // 檢查展開狀態水平與卡片溢出
      await assertNoOverflow(p, "index-390-expanded");

      // 02-index-390-hero-expanded: 首頁簡介展開狀態
      const file2 = path.join(OUT_DIR, "02-index-390-hero-expanded.png");
      await p.screenshot({ path: file2 });
      const info2 = decodeAndVerifyPng(file2, 390, 844);
      await verifyBrowserDecoding(p, file2, 390, 844);
      console.log(`Saved, Decoded & Verified: 02-index-390-hero-expanded.png (${info2.width}x${info2.height}, ${info2.size} bytes)`);

      await ctx.close();
    }

    // 2. Mobile (390 x 844) - watch.html#daily (市場決策中心上、中、下段)
    {
      const ctx = await createContext({
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

      // 手機版全卡片與文件水平溢出嚴格斷言
      await assertNoOverflow(p, "hub-390");

      // 斷言關鍵決策卡片與元素存在
      const hasCoreGrid = await p.evaluate(() => Boolean(document.querySelector(".dh-core-grid")));
      if (!hasCoreGrid) {
        throw new Error("[Assertion Failure] .dh-core-grid not rendered in watch.html#daily");
      }

      // 03-hub-390-top: 上段（核心行情卡片、早報決策結論、上漲動能與下跌風險）
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.waitForTimeout(400);
      const file3 = path.join(OUT_DIR, "03-hub-390-top.png");
      await p.screenshot({ path: file3 });
      const info3 = decodeAndVerifyPng(file3, 390, 844);
      await verifyBrowserDecoding(p, file3, 390, 844);
      console.log(`Saved, Decoded & Verified: 03-hub-390-top.png (${info3.width}x${info3.height}, ${info3.size} bytes)`);

      // 04-hub-390-mid: 中段（實盤驗證時間軸、收盤價、壓力／支撐觸及、成交量比較基準判定徽章）
      await p.evaluate(() => {
        const el = document.querySelector(".dh-card.val") || document.querySelectorAll(".dh-sec-wrap")[1];
        if (el) el.scrollIntoView({ block: "start", behavior: "instant" });
        else window.scrollTo(0, 480);
      });
      await p.waitForTimeout(400);
      const file4 = path.join(OUT_DIR, "04-hub-390-mid.png");
      await p.screenshot({ path: file4 });
      const info4 = decodeAndVerifyPng(file4, 390, 844);
      await verifyBrowserDecoding(p, file4, 390, 844);
      console.log(`Saved, Decoded & Verified: 04-hub-390-mid.png (${info4.width}x${info4.height}, ${info4.size} bytes)`);

      // 05-hub-390-bot: 下段（多因子雷達、客觀應對行動、頁尾資料來源宣告）
      await p.evaluate(() => {
        const el = document.querySelector(".dh-footer") || document.querySelectorAll(".dh-sec-wrap")[3];
        if (el) el.scrollIntoView({ block: "end", behavior: "instant" });
        else window.scrollTo(0, 1150);
      });
      await p.waitForTimeout(400);
      const file5 = path.join(OUT_DIR, "05-hub-390-bot.png");
      await p.screenshot({ path: file5 });
      const info5 = decodeAndVerifyPng(file5, 390, 844);
      await verifyBrowserDecoding(p, file5, 390, 844);
      console.log(`Saved, Decoded & Verified: 05-hub-390-bot.png (${info5.width}x${info5.height}, ${info5.size} bytes)`);

      await ctx.close();
    }

    // 3. Tablet (768 x 1024) - watch.html#daily (平板版雙欄佈局)
    {
      const ctx = await createContext({
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

      // 平板版水平溢出與卡片溢出嚴格斷言
      await assertNoOverflow(p, "hub-768");

      const file6 = path.join(OUT_DIR, "06-hub-768-tablet.png");
      await p.screenshot({ path: file6 });
      const info6 = decodeAndVerifyPng(file6, 768, 1024);
      await verifyBrowserDecoding(p, file6, 768, 1024);
      console.log(`Saved, Decoded & Verified: 06-hub-768-tablet.png (${info6.width}x${info6.height}, ${info6.size} bytes)`);

      await ctx.close();
    }

    // 4. Desktop (1280 x 800) - watch.html#daily (桌面版正常驗證)
    {
      const ctx = await createContext({
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

      // 桌面版水平溢出與卡片溢出嚴格斷言
      await assertNoOverflow(p, "hub-1280");

      const file7 = path.join(OUT_DIR, "07-hub-1280-desktop.png");
      await p.screenshot({ path: file7 });
      const info7 = decodeAndVerifyPng(file7, 1280, 800);
      await verifyBrowserDecoding(p, file7, 1280, 800);
      console.log(`Saved, Decoded & Verified: 07-hub-1280-desktop.png (${info7.width}x${info7.height}, ${info7.size} bytes)`);

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

      // 嚴格斷言畫面出現預期的安全降級文案，而不是只截圖
      const fallbackState = await p.evaluate(() => {
        const bodyText = document.body.innerText || "";
        const cboxLead = document.querySelector(".dh-cbox-lead")?.textContent || "";
        const missingCards = document.querySelectorAll(".dh-core-card.missing, .dh-missing-tag");
        const hasDefensiveText = cboxLead.includes("資料不足，暫不判定") || bodyText.includes("資料不足，暫不判定") || bodyText.includes("暫時沒有早報資料");
        const hasMissingCard = missingCards.length > 0;
        return { hasDefensiveText, hasMissingCard, cboxLead, missingCardCount: missingCards.length };
      });

      if (!fallbackState.hasDefensiveText || !fallbackState.hasMissingCard) {
        throw new Error(`[Assertion Failure] Safety fallback copy or missing cards not found on page: ${JSON.stringify(fallbackState)}`);
      }
      console.log(`Safety fallback verified: cboxLead="${fallbackState.cboxLead}", missingCardCount=${fallbackState.missingCardCount}`);

      // 缺失狀態下的溢出檢查（包含卡片與文件）
      await assertNoOverflow(p, "hub-1280-missing");

      const file8 = path.join(OUT_DIR, "08-hub-1280-missing-data.png");
      await p.screenshot({ path: file8 });
      const info8 = decodeAndVerifyPng(file8, 1280, 800);
      await verifyBrowserDecoding(p, file8, 1280, 800);
      console.log(`Saved, Decoded & Verified: 08-hub-1280-missing-data.png (${info8.width}x${info8.height}, ${info8.size} bytes)`);

      await ctx.close();
    }

    console.log("\n=== 水平溢出驗證矩陣 ===");
    console.table(overflowResults);

    console.log("\n=== 瀏覽器控制台錯誤檢查 ===");
    console.log(`Total page errors / console errors: ${pageErrors.length}`);
    if (pageErrors.length > 0) {
      console.table(pageErrors);
      throw new Error(`[Assertion Failure] Detected ${pageErrors.length} browser errors during execution.`);
    }

    // 驗證所有 8 張截圖解碼與視口精確尺寸相符
    const expectedScreenshots = [
      { name: "01-index-390-hero-collapsed.png", width: 390, height: 844 },
      { name: "02-index-390-hero-expanded.png", width: 390, height: 844 },
      { name: "03-hub-390-top.png", width: 390, height: 844 },
      { name: "04-hub-390-mid.png", width: 390, height: 844 },
      { name: "05-hub-390-bot.png", width: 390, height: 844 },
      { name: "06-hub-768-tablet.png", width: 768, height: 1024 },
      { name: "07-hub-1280-desktop.png", width: 1280, height: 800 },
      { name: "08-hub-1280-missing-data.png", width: 1280, height: 800 }
    ];

    console.log("\n=== 圖片解碼、CRC32 與精確尺寸規格驗證 ===");
    const decodeReport = [];
    for (const item of expectedScreenshots) {
      const fullPath = path.join(OUT_DIR, item.name);
      const res = decodeAndVerifyPng(fullPath, item.width, item.height);
      decodeReport.push({
        file: item.name,
        expectedDimensions: `${item.width}x${item.height}`,
        actualDimensions: `${res.width}x${res.height}`,
        fileSize: `${Math.round(res.size / 1024)} KB`,
        crcPass: "YES",
        decompressedLengthMatch: `YES (${res.decompressedBytes} B)`,
        decodable: "YES (zlib inflate PASS)"
      });
    }
    console.table(decodeReport);
    console.log("All 8 screenshots successfully verified (exist, valid PNG header, size >= 10KB, full zlib decompression PASS, exact viewport width & height matched, CRC verified).");

    // 可選複製到對話 Artifact 目錄（若環境變數有指定且目錄存在）
    if (OPTIONAL_ARTIFACT_DIR && fs.existsSync(OPTIONAL_ARTIFACT_DIR)) {
      try {
        for (const f of fs.readdirSync(OUT_DIR)) {
          if (f.endsWith(".png")) {
            fs.copyFileSync(path.join(OUT_DIR, f), path.join(OPTIONAL_ARTIFACT_DIR, f));
          }
        }
        console.log(`Copied screenshots to specified artifact dir: ${OPTIONAL_ARTIFACT_DIR}`);
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
  console.error("\nVisual validation execution failed:", err);
  process.exit(1);
});
