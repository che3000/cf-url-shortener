# Tailwind CSS 配置說明

本專案使用 Tailwind CSS v4 與官方 PostCSS 插件在建置時產生樣式，不依賴 CDN。`scripts/build-css.mjs` 將 CSS 壓縮到 `public/styles.css`，並同步產生 Worker 使用的 `src/styles/styles-inline.ts`。

## 開發流程

執行 `npm run build:css` 產生樣式；執行 `npm run watch:css` 監看 `src/` 中的模板和樣式變更，持續更新兩份產物。`npm run dev` 會先建置一次樣式，再啟動 Wrangler。修改模板後，若未啟用監看模式，請重新執行 `npm run build:css`。

`src/styles/styles.css` 使用 `@import "tailwindcss"` 載入 Tailwind，並以 `@source` 掃描 `src/` 的 TypeScript 與 JavaScript 檔案。直接在模板中寫完整的 utility class 名稱，Tailwind 才能辨識。若類別由動態字串組合，請在 CSS 中以 `@source inline(...)` 明確列出。自訂 CSS 也可以直接寫在此檔案；既有的管理介面自訂樣式在 `src/styles/custom.css.ts`。

例如：

```css
@import "tailwindcss";
@source "../**/*.{ts,js}";
@source inline("bg-blue-500 text-white");
```

Tailwind v4 的主題設定改用 CSS 的 `@theme` 指令。需要新增品牌色時，可在 `src/styles/styles.css` 加上：

```css
@theme {
  --color-brand: #1d4ed8;
}
```

生成的 `public/styles.css` 與 `src/styles/styles-inline.ts` 不需手動修改。部署前的 `npm run build` 會重新產生樣式並執行 TypeScript 檢查。

請參閱 [Tailwind CSS 官方文件](https://tailwindcss.com/docs)與 [v4 升級指南](https://tailwindcss.com/docs/upgrade-guide)。
