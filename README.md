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
| 🎨 內建 UI | 使用 Tailwind + shadcn/ui 風格 |
| 🗄️ 無需資料庫 | 使用 Cloudflare KV 儲存資料 |
| 🌐 自訂網域 | 預設使用 `s.<yourdomain>/xxxxx` |

---

## 📦 部署流程（從零開始）

### 1️⃣ 建立專案並安裝依賴

```bash
git clone https://github.com/che3000/cf-url-shortener.git
cd cf-url-shortener
npm install
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

---

### 3️⃣ 建立 KV 命名空間

```bash
wrangler kv:namespace create "LINKS"
```

會自動寫入到 `wrangler.toml`：
如果沒有的話複製id過去。

```toml
kv_namespaces = [
  { binding = "LINKS", id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
]
```

---

### 4️⃣ 設定 DNS（Cloudflare Dashboard → DNS → 紀錄）

| 類型 | 名稱 | 內容 | Proxy狀態 | TTL |
|-------|-------|---------|--------|-------|
| CNAME | `s` | `<your-worker>.workers.dev` | ☁️ Proxied (ON) | 自動 |


等大概十五分鐘後驗證：

```bash
nslookup s.<your-domain>
dig s.<your-domain> @1.1.1.1
```

若看到 104.xxx 或 172.xxx IP = 成功 ✅

---

### 5️⃣ 部署 Worker

```bash
wrangler deploy
```

看到 ✅ `Deployed cf-url-shortener` 即完成。

---

## 🔐 設定 Zero Trust（保護 /admin）

後台網址：`https://s.<your-domain>/admin`

✅ 讓一般使用者可用短網址  
✅ 只有授權信箱能登入管理頁面

---

### 5-1 建立 Access 應用程式

1. https://one.dash.cloudflare.com → **Access → 應用程式 → 加入應用程式**
2. 選 自我裝載 → 選取
3. 填入：

| 欄位 | 值 |
|-------|------|
| 應用程式名稱 | url-shortener-api |
| 工作階段持續時間 | `24h` |

新增公用主機名稱
| 欄位 | 值 |
|-------|------|
| 輸入法 | 預設 |
| 子網域 | `s` |
| 網域 | `<your-domain>` |
| 路徑 | `api/*` |

| 欄位 | 值 |
|-------|------|
| 輸入法 | 預設 |
| 子網域 | `s` |
| 網域 | `<your-domain>` |
| 路徑 | `admin` |
---

### 5-2 設定 Access 原則

基本資訊
| 欄位 | 值 |
|-------|--------|
| 原則名稱 | access-mail |
| 動作 | Allow |
| 工作階段持續時間 | 與應用程式工作階段逾時相同 |

新增規則
包含 OR
| 欄位 | 值 |
| Selector | Emails |
| Emails | 你的信箱或群組 |

範例：  
✅ 允許 `you@gmail.com`  
✅ 或允許 `@yourcompany.com` 網域  

---

### 5-3 啟用 OTP

Zero Trust → 設定 → 認證 → 登入方法 → **One-Time PIN → Enable**

如果沒收到信 → 檢查 Gmail Spam / Promotions 分類

---

## 🧑‍💻 管理介面操作說明

| 功能 | 操作方式 |
|-------|----------|
| 建立短網址 | 填入 URL → 可選 有效時間（小時） → 自訂短網址 (可空白) → 按「建立」 |
| 有效時間留空 | = 永久有效 |
| 列表剩餘時間 | 自動倒數 |
| 狀態顏色 | 🟢 active / 🟡 expiring / 🔴 expired / ⚪ invalid |
| 作廢短網址 | 按下「作廢」按鈕（不刪資料） |
| 恢復使用 | 變成「恢復有效」按鈕 |
| 已過期 / 無效短網址 | 跳出「短網址無效」畫面 |
| 刷新列表 | 按右上角「重新整理」或鍵盤上的「R」|

---

## 🔍 使用者使用短網址

✅ 生效 → 自動 301 導向  
❌ 過期/作廢 → 顯示錯誤頁

---

## 📝 自訂頁尾資訊

你可在 `wrangler.toml` 加上：

```toml
[vars]
AUTHOR = "Your Name"
CONTACT = "your@email.com"
```

---

## 🛡️ 安全設計

| 項目 | 說明 |
|-------|------|
| `/admin` + `/api/*` | 自動被 Zero Trust 保護 |
| `/[code]` 跳轉路徑 | 公開可訪問 |
| API 不需 Token，只能由 Zero Trust 登入者操作 |

---

## 🗑️ 軟刪除機制

| 狀態 | 說明 |
|--------|------|
| active | 正常使用 |
| expiring | 小於 1 小時自動黃燈 |
| expired | 自動變紅，不再跳轉 |
| invalid | 手動作廢，灰色，可恢復 |

---

## 🖼️ 自訂 favicon

在 `src/index.ts` 已內建 SVG favicon  
可直接換成你自己的，或改成 `.ico` / `.png`

---

## 📜 開源授權

GNU General Public License v3

---

## ✅完成

你現在擁有：

✅ 零成本 Cloudflare 伺服器
✅ 具備後台的短網址系統
✅ 自訂網域
✅ Zero Trust 安全保護
✅ 快速重新部署能力

如需 UI / 功能擴充，歡迎 PR 或 Issue 🔧

---
