# 即時股市資料：三種接法與設定方式

K線學堂的即時報價都經過網站伺服器的 `/api/quote`（`api/quote.js`），頁面在盤中每 10 秒問一次。

| 接法 | 要申請嗎 | 能拿到什麼 | 延遲 | 狀態 |
|---|---|---|---|---|
| 證交所 MIS | 不用 | 成交價、開高低、累計量、最佳五檔、加權／櫃買指數 | 約 5 秒一筆快照 | **已內建，預設使用** |
| 富果 Fugle 行情 API | 註冊取得 API 金鑰 | 同上，另有當日分 K、逐筆成交 | 接近即時 | **已內建**，設定金鑰後自動改用 |
| 永豐 Shioaji | 要有永豐金證券帳戶 | 逐筆推播、完整五檔、可下單 | 即時 | 要在自己的電腦或主機上跑，見第 3 節 |

> 金鑰一律放在 Vercel 的環境變數，**不要**寫進程式碼、貼到 GitHub（這個 repo 是公開的）或貼在聊天裡。

---

## 1. 證交所 MIS（已內建）

不用設定。部署後：

- 頂部會出現加權指數（盤中有紅點閃爍）。
- 「個股判讀」載入真實個股後，下方有即時列：成交價、漲跌、量、時間、五檔；今天這根 K 棒會跟著更新，指標與判讀一起重算。
- 盤中（週一到週五 09:00–13:30，08:30–09:00 是試撮）每 10 秒更新；收盤後每 5 分鐘確認一次；手機切到背景時自動暫停。

注意：

- MIS 是證交所給自己網頁用的介面，沒有正式保證，格式可能改變。
- 太頻繁會被暫時擋住；伺服器已做 4 秒快取，大部分情況不會遇到。被擋時畫面會顯示原因，稍等就會恢復。
- 檢查方式：打開 `https://你的網域/api/quote?codes=2330,t00`，看到 `"ok":true` 和 `"source":"證交所 MIS"` 就是正常。

---

## 2. 富果 Fugle 行情 API

設定好金鑰後，`/api/quote` 會自動改用富果（失敗時退回 MIS），網頁不用改。

### 2-1 申請金鑰

1. 用手機或電腦打開富果開發者網站 <https://developer.fugle.tw>，用富果帳號登入（沒有就先註冊；依官網指示完成身分驗證）。
2. 進入「行情 API」或「API 金鑰」頁面，按「建立金鑰」（或「申請 API Key」）。
3. 複製產生的金鑰（一長串英數字）。金鑰等同密碼，不要給別人。
4. 免費方案有每分鐘、每天的次數上限，請到官網的「方案」頁確認。這個網站一個人在用時，每 10 秒查一次（加權指數＋一檔個股）大約每分鐘 12 次；如果超過上限會自動退回 MIS。

### 2-2 填進 Vercel

1. 打開 <https://vercel.com>，進入這個專案（taiex-monitor-app）。
2. 上方選「Settings」→ 左邊「Environment Variables」。
3. 新增一筆：
   - **Key**：`FUGLE_API_KEY`
   - **Value**：剛剛複製的金鑰
   - **Environments**：至少勾 Production（Preview 也可以勾）
4. 按「Save」。
5. 環境變數要重新部署才生效：上方「Deployments」→ 最新一筆右邊「⋯」→「Redeploy」。

手機版 Vercel 網頁一樣可以操作；如果選單被收起來，點左上角的選單圖示找「Settings」。

### 2-3 確認

打開 `https://你的網域/api/quote?codes=2330`，看到 `"source":"富果"` 就成功了；如果還是 `"證交所 MIS"`，代表金鑰沒讀到或富果回應錯誤（檢查變數名稱是否完全一樣、是否已 Redeploy、金鑰是否有效）。

### 2-4 之後可以加的

富果還有當日 1 分 K（`intraday/candles`）和 WebSocket 即時推播。分 K 可以用來在「個股判讀」畫盤中走勢圖；需要的話再說一聲。

---

## 3. 永豐 Shioaji

Shioaji 是永豐金證券提供的 Python 套件，資料最完整（逐筆成交、完整五檔，也能下單），但：

- 要有**永豐金證券帳戶**並申請 API 權限。
- 它需要一直保持連線，所以**不能放在 Vercel**（Vercel 的程式每次只執行幾秒鐘）。要在自己的電腦、家裡的小主機或雲端主機（VPS）上執行。

### 3-1 申請

1. 開立永豐金證券帳戶（已經有就跳過）。
2. 到永豐金證券官網或「大戶投」App 找「API 服務」／「Shioaji」，線上簽署 API 使用相關同意書並申請。
3. 申請通過後，在永豐的 API 管理頁面建立 **API Key** 和 **Secret Key**（建立時可以設定權限，只看行情就不要開交易權限）。
4. 只看行情不需要憑證；要下單才需要下載並啟用電子憑證（CA）。
5. 詳細流程與最新規定以官方文件為準：<https://sinotrade.github.io/>。

### 3-2 在自己的電腦上試跑

需要 Python 3.8 以上。

```bash
pip install shioaji
export SJ_API_KEY="你的 API Key"
export SJ_SECRET_KEY="你的 Secret Key"
python quote_demo.py
```

`quote_demo.py`：

```python
import os, time
import shioaji as sj

api = sj.Shioaji()  # 想先在模擬環境測試可用 sj.Shioaji(simulation=True)
api.login(api_key=os.environ["SJ_API_KEY"], secret_key=os.environ["SJ_SECRET_KEY"])

contract = api.Contracts.Stocks["2330"]

# 一次性的快照：最新價、累計量
snap = api.snapshots([contract])[0]
print("快照", snap.close, snap.total_volume)

# 逐筆成交推播
@api.on_tick_stk_v1()
def on_tick(exchange, tick):
    print(tick.datetime, tick.close, tick.volume)

api.quote.subscribe(contract, quote_type=sj.constant.QuoteType.Tick, version=sj.constant.QuoteVersion.v1)
time.sleep(60)
api.logout()
```

套件版本更新時函式名稱可能不同，跑不起來時請對照官方文件的範例。

### 3-3 接到 K線學堂

要讓網站用 Shioaji 的資料，需要在那台一直開著的電腦或主機上，再跑一個小的網頁服務把報價轉出來（例如 `https://你的主機/quote?codes=2330`，回傳和 `/api/quote` 一樣的格式），然後讓 `api/quote.js` 優先問它。這部分需要有固定網址的主機和 HTTPS，設定比較多；確定要做的話，我可以幫你寫那個轉接服務和對應的程式。

### 3-4 注意

- API 有連線數、訂閱檔數與流量限制，超過會被暫停，以永豐公告為準。
- 程式能下單時務必小心：測試先用 `simulation=True`，並且只給需要的權限。
- API Key、Secret Key 和憑證密碼都只放在自己的電腦或主機的環境變數，不要上傳到 GitHub。
