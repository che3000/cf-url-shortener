# 🔗 Cloudflare URL Shortener

一套部署在 **Cloudflare Workers + KV** 的短網址系統，具備管理後台、有效時間、軟刪除、倒數顯示等功能，並可用 Cloudflare Zero Trust 保護後台登入。

**特色：**

| 功能 | 說明 |
|-------|------|
| 🚀 全球快速跳轉 | 由 Cloudflare Edge 提供超低延遲 |
| 🔒 Zero Trust 保護後台 | 只有授權的 Email 才能登入 `/admin` |
| 🕒 支援有效時間 (TTL) | 可設定「有效小時」，沒填即永久 |
| ♻️ 軟刪除（可恢復） | 作廢不會刪除資料，可重新啟用 |
| 📊 管理頁倒數計時 | 自動顯示剩餘時間，過期變 Expired |
| 📎 插頁廣告中轉頁 | 可設定倒數秒數的中轉頁面（支援暫停倒數、防快速跳過） |
| 🎨 內建 UI | 使用 Tailwind CSS v3 編譯版本，響應式設計 |
| 🗄️ 無需資料庫 | 使用 Cloudflare KV 儲存資料 |
| 📱 iPhone快速使用 | 使用 Cloudflare Service Token 與 Apple Shortcut 實現免登入即可新增客製化超連結 |
| 🌐 自訂網域 | 預設使用 `s.<yourdomain>/xxxxx` |

---

## 📦 部署流程（從零開始）

### 0️⃣ 先決條件（請先完成）

在開始之前，請先確認你有以下環境：

- Node.js（建議使用 LTS 版本，例如 v18+），NPM 會隨 Node 一起安裝。
- Wrangler CLI：用於本地開發與部署 Cloudflare Workers。

安裝範例：

```bash
# 安裝 Node.js：請至 https://nodejs.org 下載 LTS 版，或使用 nvm（建議）
# 安裝wrangler：
npm install -g wrangler
```

登入 Cloudflare（互動式）：

```bash
wrangler login
```

---

### 1️⃣ 建立專案並安裝依賴

```bash
git clone https://github.com/che3000/cf-url-shortener.git
cd cf-url-shortener
npm install
```

**注意：** 本專案採用模組化架構，使用 Tailwind CSS v3 編譯版本（非 CDN），以確保最佳效能。詳見 [Tailwind CSS 配置說明](./TAILWIND.md)。

**專案結構：**
```
src/
├── index.ts                    # 主要入口點與路由邏輯
├── interstitial.ts             # 插頁廣告中轉頁面
├── scripts/
│   └── admin-client.ts         # 管理後台客戶端 JavaScript
├── styles/
│   ├── custom.css.ts           # 自訂 CSS 元件
│   ├── styles.css              # Tailwind CSS 源文件
│   └── styles-inline.ts        # 自動生成的內嵌樣式（勿手動編輯）
└── templates/
    ├── admin.html.ts           # 管理後台 HTML 模板
    ├── invalid.html.ts         # 無效/過期頁面模板
    ├── root.html.ts            # 首頁模板
    └── unauthorized.html.ts    # 未授權頁面模板
```

---

### 2️⃣ 建立 `wrangler.toml`

複製範本：

```bash
cp wrangler.toml.sample wrangler.toml
```

修改：

| 欄位 | 說明 |
|-------|------|
| `name` | Worker 名稱 |
| `zone_name` | 你的網域，例如 `<your-domain>` |
| `routes` | 例如 `s.<your-domain>/*` |
| `vars` |（可選）頁尾作者名稱、Email |

範例：

```toml
name = "cf-url-shortener"
main = "src/index.ts"
compatibility_date = "2025-11-02"

kv_namespaces = [
  { binding = "LINKS", id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
]

[[routes]]
pattern = "s.<your-domain>/*"
zone_name = "<your-domain>"

[vars]
AUTHOR = "Your-Name"
CONTACT = "your@gmail.com"

[observability]
[observability.logs]
enabled = true
head_sampling_rate = 1
invocation_logs = true
persist = true
```

### 2-2 建立 `cloudflare_secrets.json`

複製範本：

```bash
cp cloudflare_secrets.json.sample cloudflare_secrets.json
```

再依「🔐 設定 Zero Trust」章節建立服務 Token，將 `CF-Access-Client-Id` 與 `CF-Access-Client-Secret` 等值填入 `cloudflare_secrets.json`。

### 2-3 Zero Trust 路徑保護說明
本專案採「Access-only」模型，Worker 本身不實作任何身份驗證。請於後續「🔐 設定 Zero Trust」章節，為 `/admin*` 與 `/api/*` 分別建立 Access 應用並以路徑強制保護。

---

### 3️⃣ 建立 KV 命名空間

```bash
wrangler kv:namespace create "LINKS"
```

會自動寫入到 `wrangler.toml`。
若未自動寫入，請手動複製 KV ID 至 `wrangler.toml`。

```toml
kv_namespaces = [
  { binding = "LINKS", id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
]
```

---

### 4️⃣ 設定 DNS（Cloudflare Dashboard → DNS → 紀錄）

| 類型 | 名稱 | 內容 | Proxy 狀態 | TTL |
|-------|-------|---------|--------|-------|
| CNAME | `s` | `<your-worker>.workers.dev` | ☁️ Proxied (ON) | 自動 |


等待約 15 分鐘後驗證：

```bash
nslookup s.<your-domain>
dig s.<your-domain> @1.1.1.1
```

若看到 104.xxx 或 172.xxx IP = 成功 ✅

Windows 也可使用（PowerShell）：

```powershell
Resolve-DnsName s.<your-domain>
```

---

### 5️⃣ 部署 Worker

部署前會自動編譯 Tailwind CSS 並生成內嵌樣式文件：

```bash
npm run deploy
```

這個命令會執行以下步驟：
1. 編譯 `src/styles/styles.css` → `public/styles.css`（壓縮版）
2. 生成 `src/styles/styles-inline.ts`（內嵌到 Worker，勿手動編輯）
3. 執行 `wrangler deploy`

看到 ✅ `Deployed cf-url-shortener` 即完成。

**開發模式：**
```bash
npm run dev
```

此命令會啟動本地開發伺服器（需要時可手動執行 `npm run build:css` 編譯樣式）。

開發中也可在另一個終端視窗執行：

```bash
npm run watch:css
```

用於持續監聽樣式變更並即時輸出到 `public/styles.css`。

---

## 🔐 設定 Zero Trust
本系統採用「Access-only 強制、Worker 無認證邏輯」的目標狀態。請在 Cloudflare Zero Trust Access 控制下依序操作：
**服務認證**
1. 建立服務 Token
   
| 欄位 | 值 |
|-------|------|
| 服務 Token 名稱 | url-shortener-token |
| 服務 Token 持續時間 | 沒有期限 |
2. 產生 Token（取得 Client Id 與 Client Secret）

3. 於專案根目錄建立 `cloudflare_secrets.json`（從範本複製後填值）
```bash
cp cloudflare_secrets.json.sample cloudflare_secrets.json
```
請手動更新 `cloudflare_secrets.json` 中的 `CF-Access-Client-Id`、`CF-Access-Client-Secret`、`base_url`，如需給捷徑使用可放到 `iCloud/Downloads`。
Shortcut 檔案仍在驗證中，下一版本會更新。
範例
```json
{
  "env": "production",
  "api": {
    "base_url": "https://s.<your-domain>/api/links"
  },
  "auth": {
    "CF-Access-Client-Id": "14XXXXXXXcdd81e4373.access",
    "CF-Access-Client-Secret": "6f7XXXXXX20b9167"
  },
  "headers": {
    "Content-Type": "application/json"
  }
}
```

**原則**
1) url-shortener-api
   
**基本資訊**
| 欄位 | 值 |
|-------|------|
| 原則名稱 | url-shortener-api |
| 動作 | Service Auth |
| 工作階段持續時間 | 與應用程式工作階段逾時相同 |

**新增規則（包含 OR）**
| 欄位 | 值 |
|-------|------|
| 選取器 | Service Token |
| 值 | url-shortener-token |
儲存

2) url-shortener-admin
   
**基本資訊**
| 欄位 | 值 |
|-------|------|
| 原則名稱 | url-shortener-admin |
| 動作 | Allow |
| 工作階段持續時間 | 與應用程式工作階段逾時相同 |

**新增規則（包含 OR）**
| 欄位 | 值 |
|-------|------|
| 選取器 | Emails |
| 值 | `your@email.com` |
儲存

**應用程式**
1) url-shortener-api
   
**基本資訊**
| 欄位 | 值 |
|-------|------|
| 應用程式名稱 | url-shortener-api |
| 工作階段持續時間 | 24 Hours |
| 子網域 | s |
| 網域 | <your-domain> |
| 路徑 | `api/*` |

**原則** 依序點選
1. 選取原則
2. url-shortener-api
3. 確認
4. 儲存應用程式

2) url-shortener-admin
   
**基本資訊**
| 欄位 | 值 |
|-------|------|
| 應用程式名稱 | url-shortener-admin |
| 工作階段持續時間 | 24 Hours |
| 子網域 | s |
| 網域 | <your-domain> |
| 路徑 | `admin*` |

**原則** 依序點選
1. 選取原則
2. url-shortener-admin
3. 確認
4. 儲存應用程式


重要原則：
- Worker 不檢查 `CF-Access-*`、`CF_Authorization`、`CF_AppSession` 等任一 header/cookie
- 任何 401/403 均由 Cloudflare Access 在 Worker 之前決定；Worker 僅根據 path 服務內容
- 人類不可直呼 `/api/*`；管理頁僅呼叫 `/admin/api/*`

注意事項：
- `CF-Access-Client-Id` 與 `CF-Access-Client-Secret` 由 Zero Trust「服務 Token」產生。
- 人類使用瀏覽器不需要此檔案；僅機器端/自動化腳本需要。

PowerShell 使用範例（讀取 secrets.json 呼叫 API）：

```powershell
$cfg = Get-Content .\cloudflare_secrets.json | ConvertFrom-Json

curl -X POST $cfg.api.base_url ^
  -H "CF-Access-Client-Id: $($cfg.auth.'CF-Access-Client-Id')" ^
  -H "CF-Access-Client-Secret: $($cfg.auth.'CF-Access-Client-Secret')" ^
  -H "Content-Type: application/json" ^
  -d '{"url":"https://example.com","ttl_hours":24}'
```

Node.js 使用範例（Node 18+）：

```js
import fs from 'node:fs/promises'

const cfg = JSON.parse(await fs.readFile('./cloudflare_secrets.json', 'utf8'))
const res = await fetch(cfg.api.base_url, {
  method: 'POST',
  headers: {
    'CF-Access-Client-Id': cfg.auth['CF-Access-Client-Id'],
    'CF-Access-Client-Secret': cfg.auth['CF-Access-Client-Secret'],
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ url: 'https://example.com', ttl_hours: 24 })
})
console.log(await res.json())
```

CI 環境建議：
- 將 `CF-Access-Client-Id`、`CF-Access-Client-Secret` 以 CI Secret/變數管理（避免保存 JSON 檔）。
- 指令可改讀取環境變數（例如 `$env:CF_ACCESS_CLIENT_ID` / `$env:CF_ACCESS_CLIENT_SECRET`）。

---

## 🧑‍💻 管理介面操作說明

| 功能 | 操作方式 |
|-------|----------|
| 建立短網址 | 填入 URL → 可選 有效時間（小時） → 自訂短網址 (可空白) → 勾選插頁廣告 → 設定秒數 → 按「建立」 |
| 有效時間留空 | = 永久有效 |
| 插頁廣告設定 | 勾選「插頁廣告」並設定秒數（預設 5 秒） |
| 編輯短網址設定 | 點擊列表中的編輯圖示 ✏️，可修改插頁廣告開關、秒數和有效時間 |
| 複製短網址 | 點擊列表中的短網址代碼即可複製完整網址到剪貼簿 |
| Toast 通知 | 建立成功、複製成功時右下角顯示綠色通知；失敗時顯示紅色通知 |
| 列表剩餘時間 | 自動倒數 |
| 狀態標籤 | ✅ active / ⏰ expiring / ❌ expired / 🚫 invalid |
| 作廢短網址 | 按下「註銷」按鈕（不刪資料） |
| 恢復使用 | 變成「恢復」按鈕 |
| 已過期短網址 | 無法編輯，顯示「過期」狀態 |
| 無效短網址 | 跳出「短網址無效」畫面 |
| 刷新列表 | 按右上角「重新整理」或鍵盤上的「R」|
| 響應式設計 | 手機版 12px 字體，電腦版 16px 字體，自動調整欄位顯示 |
| URL 長度優化 | 手機版顯示最多 25 字元，電腦版最多 40 字元，超過顯示「...」 |
| 時間格式 | 24 小時制（YYYY/MM/DD HH:MM:SS） |

### API 認證流程

| Path | 使用者 | 驗證條件 |
|------|--------|----------|
| `/api/*` | 機器 | 以 Access Service Token 呼叫，需附上 `CF-Access-Client-Id` 與 `CF-Access-Client-Secret` headers；無人類登入頁面 |
| `/admin*` | 人類 | 由 Access 驗證 Email 登入（Cookies 由 Access 管理）；瀏覽器端僅呼叫 `/admin/api/*` |
| `/admin/api/*` | 人類 | 僅同源（Same-Origin）呼叫，受 `/admin*` 的 Access 規則保護 |

curl 範例（機器呼叫 `/api/*`，使用 Service Token）：

```powershell
$env:CF_ACCESS_CLIENT_ID="<client-id>"
$env:CF_ACCESS_CLIENT_SECRET="<client-secret>"

curl -X POST "https://s.<your-domain>/api/links" ^
  -H "CF-Access-Client-Id: $env:CF_ACCESS_CLIENT_ID" ^
  -H "CF-Access-Client-Secret: $env:CF_ACCESS_CLIENT_SECRET" ^
  -H "Content-Type: application/json" ^
  -d '{"url":"https://example.com","ttl_hours":24}'

curl "https://s.<your-domain>/api/links?limit=100&expand=1" ^
  -H "CF-Access-Client-Id: $env:CF_ACCESS_CLIENT_ID" ^
  -H "CF-Access-Client-Secret: $env:CF_ACCESS_CLIENT_SECRET"

curl -X PATCH "https://s.<your-domain>/api/links/<code>" ^
  -H "CF-Access-Client-Id: $env:CF_ACCESS_CLIENT_ID" ^
  -H "CF-Access-Client-Secret: $env:CF_ACCESS_CLIENT_SECRET" ^
  -H "Content-Type: application/json" ^
  -d '{"action":"invalidate"}'
```

備註：本服務會回應 `OPTIONS`，並僅允許同源 CORS（Access-Control-Allow-Origin: <same-origin>）。

### UI 互動體驗

#### Toast 通知系統
所有操作結果都會以右下角的彈窗通知顯示：

| 通知類型 | 背景顏色 | 圖示 | 顯示時機 |
|---------|---------|------|---------|
| ✅ 成功通知 | 綠色 (#10b981) | ✓ 打勾 | 建立成功、複製成功 |
| ❌ 錯誤通知 | 紅色 (#ef4444) | ⓘ 警告 | 建立失敗、複製失敗 |

- 通知會自動在 2.5 秒後消失
- 使用滑入/滑出動畫效果
- 一次只顯示一個通知

#### 一鍵複製功能
- **建立短網址**：建立成功後自動複製到剪貼簿
- **短網址列表**：點擊任何短網址代碼即可複製完整網址
- 複製成功時顯示綠色 Toast 通知
- 複製失敗時顯示紅色 Toast 通知並說明原因

---

### 自訂短碼規則

建立短碼時如果填寫「自訂短網址」，需符合下列規則：

- 只能包含英數、底線與連字號（Regex: `^[\w-]{3,64}$`）
- 長度 3–64 字元

不符合規則會被拒絕；若留空則系統自動產生隨機 6 碼。

## 🔍 使用者使用短網址

✅ **正常跳轉** → 直接 302 重導向  
🎬 **啟用插頁廣告** → 顯示中轉倒數頁面  
❌ **過期/作廢** → 顯示錯誤頁  
🏠 **訪問根路徑** → 顯示簡潔首頁  
🚫 **訪問不存在的頁面** → 5 秒後自動跳轉回首頁

### 插頁廣告中轉頁功能

當短網址啟用插頁廣告時，使用者會先看到倒數中轉頁面：

| 功能 | 說明 |
|------|------|
| ⏱️ 倒數計時 | 自動倒數至 0 秒後跳轉 |
| 🔄 分頁暫停 | 切換到其他分頁時暫停倒數，切回才繼續 |
| 📑 Title 提示 | 顯示剩餘秒數（如：`(5秒) 即將為您跳轉…`） |
| 💬 切換提示 | 背景分頁顯示「切回來才會繼續倒數喔 嘻嘻」 |
| 🚫 防快速跳過 | 剩餘時間超過 80% 點擊「立即前往」會加罰 10 秒並暫時鎖定按鈕 |
| ✨ 使用者體驗 | 只有真正觀看頁面時才倒數，避免背景浪費時間 |

- 為避免快速連點，按下「立即前往」後會短暫停用按鈕與滑鼠事件，待加罰訊息隱藏後才恢復。


---

## 🛡️ 安全設計

| 項目 | 說明 |
|-------|------|
| 路徑所有權 | `/` 與 `/{shortCode}` 公開；`/admin*` 人類（Email Login via Access）；`/api/*` 機器（Service Token via Access） |
| 認證模型 | Access-only；Worker 不檢查任何 `CF-Access-*` 或 cookies，也不回傳自訂 401/403 |
| `/admin` | 以 Access 驗證人員；管理頁僅呼叫 `/admin/api/*` |
| `/api/*` | 僅能被 Service Token 存取；不可由瀏覽器直接呼叫 |
| `/` 根路徑 | 顯示簡潔首頁，可自訂 AUTHOR 和 CONTACT 資訊 |
| `/[code]` 跳轉路徑 | 公開可訪問 |
| 不存在的路徑 | 顯示「這裡不是你該來的地方」，5 秒後自動跳轉回首頁 |
| 管理 API | `/admin/api/*` 僅供同源、已登入的人員；`/api/*` 僅供 Service Token 使用 |

---

## 🗑️ 軟刪除機制

| 狀態 | 說明 |
|--------|------|
| active | 正常使用 |
| expiring | 小於 1 小時自動黃燈 |
| expired | 自動變紅，不再跳轉 |
| invalid | 手動作廢，灰色，可恢復 |

---

## 🎨 自訂樣式

### 編輯 Tailwind CSS
修改 `src/styles/styles.css`，然後執行：
```bash
npm run build:css
```

### 添加自訂 CSS 元件
編輯 `src/styles/custom.css.ts`，可添加卡片、按鈕、徽章等自訂樣式。

### 修改 HTML 模板
- **管理後台**：`src/templates/admin.html.ts`
- **首頁**：`src/templates/root.html.ts`
- **錯誤頁面**：`src/templates/invalid.html.ts`、`src/templates/unauthorized.html.ts`

### 自訂客戶端 JavaScript
編輯 `src/scripts/admin-client.ts` 修改後台互動邏輯。

### 自訂 favicon
在 `src/index.ts` 已內建 SVG favicon，可直接替換或改用 `.ico` / `.png`。

詳細說明請參考 [Tailwind CSS 配置說明](./TAILWIND.md)。

附註（TS 匯入副檔名）：
- 專案採 ESM 與 Bundler 模組解析，TS 原始碼中以 `.js` 副檔名引用產出檔屬於刻意設計，無需修改。

---

## 📜 開源授權

GNU General Public License v3

---

## ✅ 完成

你現在擁有：

✅ 零成本 Cloudflare 伺服器
✅ 具備後台的短網址系統
✅ 自訂網域
✅ Zero Trust 安全保護
✅ 快速重新部署能力

如需 UI / 功能擴充，歡迎 PR 或 Issue 🔧

---
