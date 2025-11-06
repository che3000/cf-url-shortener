# Tailwind CSS 配置說明

本專案使用 **Tailwind CSS v3** 進行樣式管理，採用 PostCSS 編譯而非 CDN 方式，以確保生產環境的最佳效能。

## 檔案結構

```
cf-url-shortener/
├── src/
│   ├── styles/
│   │   ├── styles.css          # Tailwind CSS 源文件（包含 @tailwind directives）
│   │   ├── styles-inline.ts    # 自動生成的內嵌 CSS（不要手動編輯）
│   │   └── custom.css.ts       # 自訂 CSS 樣式
│   ├── templates/              # HTML 模板檔案
│   │   ├── admin.html.ts       # 管理後台 HTML
│   │   ├── invalid.html.ts     # 無效頁面
│   │   ├── root.html.ts        # 首頁
│   │   └── unauthorized.html.ts # 未授權頁面
│   ├── scripts/                # 客戶端 JavaScript
│   │   └── admin-client.ts     # 管理後台 JavaScript
│   ├── index.ts                # Worker 主文件
│   └── interstitial.ts         # 插頁廣告
├── public/
│   └── styles.css              # 編譯後的 CSS（壓縮版）
├── tailwind.config.js          # Tailwind 配置
├── postcss.config.js           # PostCSS 配置
└── package.json
```

## 開發流程

### 1. 編譯 CSS

```bash
npm run build:css
```

此命令會：
1. 使用 Tailwind CLI 編譯 `src/styles/styles.css` → `public/styles.css`（壓縮版）
2. 將編譯後的 CSS 轉換為 TypeScript 常數並儲存到 `src/styles/styles-inline.ts`

### 2. 監聽模式（開發用）

```bash
npm run watch:css
```

此命令會監聽 `src/styles/styles.css` 的變化並自動重新編譯。

**注意：** 監聽模式不會自動生成 `styles-inline.ts`，需要手動執行 `npm run build:css`。

### 3. 開發伺服器

```bash
npm run dev
```

此命令會先編譯 CSS，然後啟動 Wrangler 開發伺服器。

### 4. 部署

```bash
npm run deploy
```

此命令會先編譯 CSS，然後部署到 Cloudflare Workers。

## 修改樣式

### 方法 1：使用 Tailwind Utility Classes（推薦）

直接在 HTML 模板檔案（如 `src/templates/admin.html.ts`）中使用 Tailwind 類別：

```typescript
export const renderAdminHTML = () => `
  <div class="bg-slate-50 p-6">
    <h1 class="text-2xl font-semibold">標題</h1>
  </div>
`;
```

修改後執行 `npm run build:css` 重新編譯。

**注意：** 如果使用動態類別或響應式類別,請確保已在 `tailwind.config.js` 的 `safelist` 中聲明,否則可能會被 Tailwind 的 PurgeCSS 移除。

### 方法 2：自定義 CSS

在 `src/styles/styles.css` 中添加自定義樣式：

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* 自定義樣式 */
.my-custom-class {
  @apply bg-blue-500 text-white px-4 py-2 rounded;
}
```

### 方法 3：擴展 Tailwind 配置

在 `tailwind.config.js` 中擴展主題：

```javascript
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,html}"],
  theme: {
    extend: {
      colors: {
        'brand': '#1d4ed8',
      },
    },
  },
  plugins: [],
}
```

## 生產環境優化

### CSS 內嵌

編譯後的 CSS 被內嵌到 Worker 中（透過 `styles-inline.ts`），這樣做的好處：

1. **零延遲**：CSS 直接從 Worker 提供，無需額外的網路請求
2. **全球分發**：CSS 隨 Worker 部署到全球邊緣節點
3. **版本一致**：CSS 和 JavaScript 始終保持同步

### 檔案大小

- 未壓縮的 Tailwind CSS：~3.5MB
- 編譯並壓縮後（僅包含使用的類別）：~9KB

Tailwind 的 PurgeCSS 功能會自動移除未使用的樣式，大幅減少檔案大小。

## 常見問題

### Q: 為什麼不使用 CDN？

A: Tailwind CDN 有以下限制：
- 包含所有 Tailwind 類別（~3.5MB），即使只用了少數
- 不支援生產環境優化（如 PurgeCSS）
- 增加額外的網路請求
- 無法自定義配置

### Q: 修改 HTML 後樣式沒有更新？

A: 請確保執行 `npm run build:css` 重新編譯 CSS。Tailwind 會掃描 `src/**/*.{js,ts,jsx,tsx}` 中使用的類別。

### Q: 如何添加新的 Tailwind 插件？

A: 
1. 安裝插件：`npm install -D @tailwindcss/forms`
2. 在 `tailwind.config.js` 中添加：
   ```javascript
   plugins: [
     require('@tailwindcss/forms'),
   ],
   ```
3. 重新編譯：`npm run build:css`

### Q: styles-inline.ts 可以手動編輯嗎？

A: 不建議。此檔案由 `npm run build:css` 自動生成，手動修改會在下次編譯時被覆蓋。如需修改樣式，請編輯 `src/styles/styles.css` 或使用 Tailwind 類別。若需添加自訂 CSS，可在 `src/styles/custom.css.ts` 中添加。

## 資源連結

- [Tailwind CSS 官方文檔](https://tailwindcss.com/docs)
- [Tailwind CSS v3 升級指南](https://tailwindcss.com/docs/upgrade-guide)
- [PostCSS 文檔](https://postcss.org/)
