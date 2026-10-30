# 鎖定：learner/watch.html 盤中分 K 載入逾時

- 實作者：ChatGPT（使用者於 2026-10-30 明確授權本次大盤分 K 修復）
- 分支：`chatgpt/index-intraday-timeout`
- 鎖定區塊：`learner/watch.html` 的 `getJ()` 請求逾時計算；只調整當日 `/api/intraday` 請求，不改歷史分 K、其他 API、資料來源、密鑰或 Vercel 設定。
- 配套測試：`tests/e2e/idxamt.test.mjs`，覆蓋超過既有 20 秒逾時仍可完成資料載入與圖表繪製。
- 限制：mock 測試、不呼叫 Fugle／Yahoo 真實 API；不合併、不部署。
