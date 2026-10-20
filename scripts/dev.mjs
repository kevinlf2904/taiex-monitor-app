import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PORT = process.env.PORT || 3000;
const PROXY_TARGET = process.env.API_HOST || "https://kline-school.vercel.app";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json"
};

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);

  // 自動轉發 /api/* 到線上正式站，讓本地預覽免部署也能即時拿到真實即時報價、大盤與個股資料！
  if (urlObj.pathname.startsWith("/api/")) {
    const targetUrl = new URL(req.url, PROXY_TARGET);
    try {
      const upstream = await fetch(targetUrl.href, {
        method: req.method,
        headers: {
          "user-agent": req.headers["user-agent"] || "Mozilla/5.0",
          "accept": req.headers["accept"] || "*/*"
        }
      });
      res.writeHead(upstream.status, {
        "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
        "access-control-allow-origin": "*"
      });
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.end(buf);
    } catch (e) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "API Proxy error: " + e.message }));
    }
    return;
  }

  let u = decodeURIComponent(urlObj.pathname);
  if (u === "/" || u === "") u = "/learner/";
  if (u.endsWith("/")) u += "index.html";
  const f = path.join(ROOT, u);
  try {
    const data = await readFile(f);
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(f)] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 Not Found");
  }
});

server.listen(PORT, () => {
  console.log(`\n🚀 本地即時預覽伺服器已啟動（已連動線上 API 真實資料）！`);
  console.log(`👉 首頁： http://localhost:${PORT}/learner/`);
  console.log(`👉 看盤： http://localhost:${PORT}/learner/watch.html`);
  console.log(`👉 存股： http://localhost:${PORT}/learner/savings.html\n`);
  console.log(`已自動轉發 /api/* ➔ ${PROXY_TARGET}`);
  console.log(`修改程式碼後存檔，在瀏覽器按 F5 即可即時預覽！按 Ctrl + C 可停止。\n`);
});
