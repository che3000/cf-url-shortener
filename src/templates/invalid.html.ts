import { CUSTOM_CSS } from '../styles/custom.css.js';

export const renderInvalidHTML = (host: string, code: string) => `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>短網址無效 - ${host}</title>
<link rel="stylesheet" href="/styles.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${CUSTOM_CSS}</style>
</head>
<body class="bg-slate-50">
	<div class="min-h-screen flex items-center justify-center p-6">
		<div class="max-w-lg w-full bg-white border rounded-2xl shadow p-6 text-center">
			<div class="text-5xl mb-3">🔗</div>
			<h1 class="text-xl font-semibold mb-2">短網址無效或已過期</h1>
			<p class="text-slate-600">短網址 <code class="px-2 py-1 bg-slate-100 rounded border">${code}</code> 無法使用。</p>
			<p class="text-slate-600">請聯繫給你連結的人。</p>
		</div>
	</div>
</body>
</html>`;
