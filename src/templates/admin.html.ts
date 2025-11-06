import { CUSTOM_CSS } from '../styles/custom.css.js';
import { ADMIN_CLIENT_JS } from '../scripts/admin-client.js';

export const renderAdminHTML = () => `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>URL Shortener</title>
<link rel="stylesheet" href="/styles.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${CUSTOM_CSS}</style>
</head>
<body class="bg-slate-50">
	<div class="container-wrapper mx-auto p-6 space-y-6">
		<header>
			<h1 class="text-2xl font-semibold tracking-tight">URL Shortener</h1>
			<p class="text-slate-600">已由 Cloudflare Access 保護</p>
		</header>

		<section class="card p-5">
			<h2 class="text-lg font-medium mb-3">建立短網址</h2>
			<form id="create-form" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 items-end">
				<div class="sm:col-span-2">
					<label class="block text-sm text-slate-600 mb-1">原始網址 (URL)</label>
					<input id="url" type="text" placeholder="https://example.com" class="w-full border rounded-lg px-3 py-2"/>
				</div>
				<div>
					<label class="block text-sm text-slate-600 mb-1">有效小時 (可留空=永久)</label>
					<input id="ttlHours" type="number" min="1" placeholder="24" class="w-full border rounded-lg px-3 py-2"/>
				</div>
				<div>
					<label class="block text-sm text-slate-600 mb-1">自訂短網址 (可空白)</label>
					<input id="code" type="text" placeholder="my-link" class="w-full border rounded-lg px-3 py-2"/>
				</div>
				<div>
					<label class="block text-sm text-slate-600 mb-1">插頁廣告</label>
					<input id="useInterstitial" type="checkbox" class="mr-2" style="zoom:200%"/>
				</div>
				<div>
					<label class="block text-sm text-slate-600 mb-1">廣告秒數</label>
					<input id="interstitialSeconds" type="number" min="1" placeholder="5" class="w-full border rounded-lg px-3 py-2" disabled/>
				</div>
				<div class="sm:col-span-2 md:col-span-4">
					<button class="btn btn-primary w-full sm:w-auto">建立</button>
					<span id="create-msg" class="ml-0 sm:ml-3 text-sm block sm:inline mt-2 sm:mt-0"></span>
				</div>
			</form>
		</section>

		<section class="card p-3 sm:p-5">
			<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
				<h2 class="text-lg font-medium">短網址清單</h2>
				<div id="filters" class="flex flex-wrap items-center gap-3 sm:gap-4 text-s sm:text-base">
					<label class="flex items-center gap-2"><input type="checkbox" value="active" checked> ✅ 有效</label>
					<label class="flex items-center gap-2"><input type="checkbox" value="expiring" checked> ⏰ 即將到期</label>
					<label class="flex items-center gap-2"><input type="checkbox" value="expired"> ❌ 已過期</label>
					<label class="flex items-center gap-2"><input type="checkbox" value="invalid" checked> 🚫 無效</label>
				</div>
				<div class="text-xs sm:text-sm text-slate-600 flex items-center gap-2">
					<span id="list-count" class="hidden sm:inline"></span>
					<button id="refresh" class="btn text-xs sm:text-sm px-2 py-1 sm:px-3 sm:py-2">
						<span class="refresh-text">重新整理 <span class="kbd hidden sm:inline">R</span></span>
					</button>
				</div>
			</div>
			<div class="overflow-auto">
				<table class="w-full border table-auto">
					<thead class="bg-slate-100">
						<tr>
							<th data-sort="code" class="border px-1 sm:px-2 py-1 text-left">短網址 ⇅</th>
							<th data-sort="url" class="border px-1 sm:px-2 py-1 text-left">原始網址 ⇅</th>
							<th data-sort="created" class="border px-1 sm:px-2 py-1 text-left lg:table-cell" style="display: none;">建立時間 ⇅</th>
							<th data-sort="expiresAt" class="border px-1 sm:px-2 py-1 text-left md:table-cell" style="display: none;">到期時間 ⇅</th>
							<th data-sort="remaining" class="border px-1 sm:px-2 py-1 text-left">剩餘 ⇅</th>
							<th data-sort="status" class="border px-1 sm:px-2 py-1 text-center">狀態 ⇅</th>
							<th data-sort="interstitial" class="border px-1 sm:px-2 py-1 text-center xl:table-cell" style="display: none;">廣告 ⇅</th>
							<th data-sort="interstitialSeconds" class="border px-1 sm:px-2 py-1 text-center xl:table-cell" style="display: none;">秒數 ⇅</th>
							<th class="border px-1 sm:px-2 py-1 text-center">動作</th>
						</tr>
					</thead>
					<tbody id="list-body"></tbody>
				</table>
			</div>
			<div class="mt-3 flex flex-col sm:flex-row items-center gap-2">
				<div class="flex gap-2">
					<button id="prev" class="btn disabled:opacity-50 text-xs sm:text-sm px-2 py-1 sm:px-3 sm:py-2" disabled>上一頁</button>
					<button id="next" class="btn disabled:opacity-50 text-xs sm:text-sm px-2 py-1 sm:px-3 sm:py-2" disabled>下一頁</button>
				</div>
				<span id="page-info" class="text-slate-600 text-xs sm:text-sm"></span>
			</div>
		</section>
	</div>

	<!-- 編輯廣告設定的彈出式對話框 -->
	<div id="edit-modal" class="modal" style="display:none">
		<div class="modal-content">
			<h3 class="text-lg font-semibold mb-4">編輯短網址設定</h3>
			<div class="space-y-4">
				<div>
					<label class="flex items-center gap-2">
						<input type="checkbox" id="modal-interstitial-enabled" class="w-4 h-4">
						<span>啟用插頁廣告</span>
					</label>
				</div>
				<div>
					<label class="block text-sm text-slate-600 mb-1">廣告秒數</label>
					<input type="number" id="modal-interstitial-seconds" min="1" 
						class="w-full border rounded-lg px-3 py-2" placeholder="5">
				</div>
				<div>
					<label class="block text-sm text-slate-600 mb-1">有效小時 (留空=永久，更新後會從現在開始計算延長小時)</label>
					<input type="number" id="modal-ttl-hours" min="1" 
						class="w-full border rounded-lg px-3 py-2" placeholder="留空表示永久有效">
				</div>
			</div>
			<div class="mt-6 flex gap-2 justify-end">
				<button id="modal-cancel" class="btn">取消</button>
				<button id="modal-save" class="btn btn-primary">儲存</button>
			</div>
		</div>
	</div>

<script>${ADMIN_CLIENT_JS}</script>
</body></html>`;
