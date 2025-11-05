// Cloudflare Workers - URL Shortener (hours TTL + soft delete + improved UI & security)

import { renderInterstitialHTML } from "./interstitial";
import { STYLES_CSS } from "./styles-inline";

const FAVICON_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24">
	<defs>
		<linearGradient id="g" x1="0" x2="1">
			<stop offset="0" stop-color="#6366f1"/>
			<stop offset="1" stop-color="#06b6d4"/>
		</linearGradient>
	</defs>
	<rect x="2" y="2" width="20" height="20" rx="4" fill="url(#g)"/>
	<path d="M8.5 12a2.5 2.5 0 0 1 0-3.5l2-2a2.5 2.5 0 0 1 3.5 3.5l-.6.6"
				stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
	<path d="M15.5 12a2.5 2.5 0 0 1 0 3.5l-2 2a2.5 2.5 0 1 1-3.5-3.5l.6-.6"
				stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;


export interface Env {
	LINKS: KVNamespace;
	AUTHOR?: string;
	CONTACT?: string;
}

type KVValue = {
	url: string;
	created: number;     // epoch seconds
	ttl?: number;        // seconds (undefined = 永久)
	valid?: boolean;     // soft delete: false = 註銷
	interstitial_enabled: boolean;
	interstitial_seconds?: number;
	interstitial_template?: string;
};

type KVListResult = {
	keys: { name: string }[];
	list_complete: boolean;
	cursor?: string;
};

type ListedItem = {
	code: string;
	url?: string;
	created?: number;
	ttl?: number | null;
	expiresAt?: number | null;
	status?: "active" | "expiring" | "expired" | "invalid";
	interstitial_enabled?: boolean;
	interstitial_seconds?: number | null;
	remaining?: number | null;
};

const SOON_THRESHOLD_SEC = 3600;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(globalThis.JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", ...headers },
	});

const normalizeUrl = (raw?: string | null): string | null => {
	if (!raw) return null;
	let s = String(raw).trim();
	if (!s) return null;
	const hasScheme = /^[a-zA-Z][\w+.-]*:/.test(s);
	if (!hasScheme) s = `https://${s}`;
	try {
		const u = new URL(s);
		if (u.protocol !== "http:" && u.protocol !== "https:") return null;
		return u.toString();
	} catch { return null; }
};

const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const genCode = (len = 6) =>
	Array.from(crypto.getRandomValues(new Uint8Array(len)))
		.map((n) => alphabet[n % alphabet.length])
		.join("");

const getBody = async (req: Request) => {
	const ct = req.headers.get("content-type") || "";
	if (ct.includes("application/json")) return (await req.json().catch(() => ({}))) as Record<string, unknown>;
	if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
		const form = await req.formData();
		const obj: Record<string, unknown> = {};
		for (const [k, v] of form.entries()) obj[k] = typeof v === "string" ? v : v.name;
		return obj;
	}
	return {};
};

const nowSec = () => Math.floor(Date.now() / 1000);

function computeMeta(v: KVValue | null) {
	if (!v) return { expiresAt: null, status: "expired" as const, remaining: null };
	if (v.valid === false) return { expiresAt: null, status: "invalid" as const, remaining: null };
	if (!v.ttl) return { expiresAt: null, status: "active" as const, remaining: null };
	const exp = v.created + v.ttl;
	const now = nowSec();
	const remain = exp - now;
	if (remain <= 0) return { expiresAt: exp, status: "expired" as const, remaining: 0 };
	if (remain <= SOON_THRESHOLD_SEC) return { expiresAt: exp, status: "expiring" as const, remaining: remain };
	return { expiresAt: exp, status: "active" as const, remaining: remain };
}

/* ---------- Admin UI ---------- */
const ADMIN_HTML = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>URL Shortener</title>
<link rel="stylesheet" href="/styles.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
:root{--radius:.75rem}
.card{border-radius:var(--radius);border:1px solid rgb(226 232 240);background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.btn{border:1px solid rgb(203 213 225);border-radius:.6rem;padding:.5rem .9rem}
.btn-primary{background:#000;color:#fff;border-color:#000}
.btn:hover{opacity:.9}
.badge{display:inline-flex;align-items:center;gap:.35rem;border-radius:999px;padding:.2rem .6rem;font-size:.75rem;line-height:1}
.badge.green{background:#10b98122;color:#065f46;border:1px solid #10b98155}
.badge.amber{background:#f59e0b22;color:#78350f;border:1px solid #f59e0b55}
.badge.red{background:#ef444422;color:#7f1d1d;border:1px solid #ef444455}
.badge.gray{background:#64748b22;color:#0f172a;border:1px solid #64748b55}
.link{color:#1d4ed8;text-decoration:underline;text-underline-offset:2px}
.kbd{border:1px solid rgb(203 213 225);border-bottom-width:2px;border-radius:.4rem;padding:.15rem .4rem;font-size:.75rem;background:#f8fafc}
th[data-sort]{cursor:pointer}
.modal{position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:50}
.modal-content{background:#fff;border-radius:0.5rem;padding:1.5rem;max-width:28rem;width:90%}
.edit-icon{cursor:pointer;color:#64748b;transition:color 0.2s}
.edit-icon:hover{color:#1d4ed8}
.container-wrapper{width:100%;max-width:100%}
@media (min-width:640px){.container-wrapper{max-width:65%}}
table{font-size:12px;table-layout:auto}
@media (min-width:640px){table{font-size:16px}}
table th, table td{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
table th:nth-child(2), table td:nth-child(2){white-space:normal;word-break:break-all;max-width:200px}
@media (min-width:768px){table th:nth-child(2), table td:nth-child(2){max-width:none}}
.toast{position:fixed;bottom:2rem;right:2rem;color:#fff;padding:1rem 1.5rem;border-radius:0.5rem;box-shadow:0 10px 15px -3px rgba(0,0,0,0.1),0 4px 6px -2px rgba(0,0,0,0.05);display:flex;align-items:center;gap:0.75rem;z-index:100;animation:slideIn 0.3s ease-out}
.toast.success{background:#10b981}
.toast.error{background:#ef4444}
@keyframes slideIn{from{transform:translateX(120%);opacity:0}to{transform:translateX(0);opacity:1}}
.toast.hide{animation:slideOut 0.3s ease-in forwards}
@keyframes slideOut{from{transform:translateX(0);opacity:1}to{transform:translateX(120%);opacity:0}}
</style>
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
					<label class="flex items-center gap-1.5"><input type="checkbox" value="active" checked> ✅ 有效</label>
					<label class="flex items-center gap-1.5"><input type="checkbox" value="expiring" checked> ⏰ 即將到期</label>
					<label class="flex items-center gap-1.5"><input type="checkbox" value="expired"> ❌ 已過期</label>
					<label class="flex items-center gap-1.5"><input type="checkbox" value="invalid" checked> 🚫 無效</label>
				</div>
				<div class="text-xs sm:text-sm text-slate-600 flex items-center gap-2">
					<span id="list-count" class="hidden sm:inline"></span>
					<button id="refresh" class="btn text-xs sm:text-sm px-2 py-1 sm:px-3 sm:py-2">重新整理 <span class="kbd hidden sm:inline">R</span></button>
				</div>
			</div>
			<div class="overflow-auto -mx-3 sm:mx-0">
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

<script>
const base = location.origin;
const $ = (s)=>document.querySelector(s);
const form = $("#create-form"), msg=$("#create-msg"), tbody=$("#list-body");
const btnRefresh=$("#refresh"), listCount=$("#list-count");
const btnPrev=$("#prev"), btnNext=$("#next"), pageInfo=$("#page-info");
const editModal = $("#edit-modal");
const modalEnabled = $("#modal-interstitial-enabled");
const modalSeconds = $("#modal-interstitial-seconds");
const modalTtlHours = $("#modal-ttl-hours");
const modalCancel = $("#modal-cancel");
const modalSave = $("#modal-save");

let allLinks = [], countdownTimer = null;
let currentSort = { key: 'created', dir: 'asc' };
let currentPage = 0;
const PAGE_SIZE = 100;
let editingCode = null; // 當前正在編輯的短網址代碼
let countdownElements = []; // 快取需要倒數的元素及其到期時間

// 顯示 Toast 通知
const showToast = (message, type = 'success') => {
	// 移除現有的 toast（如果有）
	const existingToast = document.querySelector('.toast');
	if (existingToast) {
		existingToast.remove();
	}
	
	// 根據類型選擇圖示
	const icon = type === 'success' 
		? \`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<polyline points="20 6 9 17 4 12"></polyline>
			</svg>\`
		: \`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<circle cx="12" cy="12" r="10"></circle>
				<line x1="12" y1="8" x2="12" y2="12"></line>
				<line x1="12" y1="16" x2="12.01" y2="16"></line>
			</svg>\`;
	
	// 建立新的 toast
	const toast = document.createElement('div');
	toast.className = \`toast \${type}\`;
	toast.innerHTML = \`
		\${icon}
		<span>\${message}</span>
	\`;
	document.body.appendChild(toast);
	
	// 2.5 秒後自動消失
	setTimeout(() => {
		toast.classList.add('hide');
		setTimeout(() => {
			toast.remove();
		}, 300); // 等待動畫完成
	}, 2500);
};

// 根據視窗大小更新響應式欄位顯示
const updateResponsiveColumns = () => {
	const width = window.innerWidth;
	
	// 建立時間欄位 (lg: >= 1024px)
	const createdCells = document.querySelectorAll('th[data-sort="created"], tbody td:nth-child(3)');
	createdCells.forEach((el) => {
		el.style.display = width >= 1024 ? 'table-cell' : 'none';
	});
	
	// 到期時間欄位 (md: >= 768px)
	const expiresCells = document.querySelectorAll('th[data-sort="expiresAt"], tbody td:nth-child(4)');
	expiresCells.forEach((el) => {
		el.style.display = width >= 768 ? 'table-cell' : 'none';
	});
	
	// 廣告欄位 (xl: >= 1280px)
	const adCells = document.querySelectorAll('th[data-sort="interstitial"], tbody td:nth-child(7)');
	adCells.forEach((el) => {
		el.style.display = width >= 1280 ? 'table-cell' : 'none';
	});
	
	// 秒數欄位 (xl: >= 1280px)
	const secondsCells = document.querySelectorAll('th[data-sort="interstitialSeconds"], tbody td:nth-child(8)');
	secondsCells.forEach((el) => {
		el.style.display = width >= 1280 ? 'table-cell' : 'none';
	});
};

const fmt = (sec)=>{
	if (sec == null) return "N/A";
	const s = Math.max(0, Math.floor(sec));
	const h = Math.floor(s/3600), m=Math.floor((s%3600)/60), r=s%60;
	if (h) return \`\${h}h \${m}m \${r}s\`;
	if (m) return \`\${m}m \${r}s\`;
	return \`\${r}s\`;
};
const fmtTime = (t)=> {
	if (!t) return "永久";
	const date = new Date(t*1000);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	const seconds = String(date.getSeconds()).padStart(2, '0');
	return \`\${year}/\${month}/\${day} \${hours}:\${minutes}:\${seconds}\`;
};

// 格式化 URL 顯示
// 電腦版：顯示完整 URL
// 手機版：移除 https://, http://, www. 前綴
const fmtUrl = (url, isMobile = false) => {
	if (!url) return '';
	if (!isMobile) {
		// 電腦版：顯示完整 URL
		return url;
	}
	// 手機版：移除 protocol 和 www
	let cleaned = url.replace(/^https?:\\/\\//, '');
	cleaned = cleaned.replace(/^www\\./, '');
	// 移除尾部的 /
	cleaned = cleaned.replace(/\\/$/, '');
	return cleaned;
};

function startCountdown(){
	if (countdownTimer) clearInterval(countdownTimer);
	if (countdownElements.length === 0) return;
	
	countdownTimer = setInterval(()=>{
		const now = Math.floor(Date.now() / 1000);
		for (let i = 0; i < countdownElements.length; i++) {
			const { element, expiresAt } = countdownElements[i];
			const left = Math.max(0, expiresAt - now);
			element.textContent = fmt(left);
		}
	}, 1000);
}

async function createLink(e){
	e.preventDefault();
	try{
		const ttlHoursStr = $("#ttlHours").value.trim();
		const ttl_hours = ttlHoursStr ? Number(ttlHoursStr) : undefined;
		const useInterstitial = $("#useInterstitial").checked;
		const interstitialSecondsValue = $("#interstitialSeconds").value;
		
		const body = {
			url: $("#url").value.trim(),
			ttl_hours,
			code: $("#code").value.trim() || undefined,
			interstitial_enabled: useInterstitial,
			interstitial_seconds: useInterstitial && interstitialSecondsValue ? Number(interstitialSecondsValue) : 0
		};
	const res = await fetch(base + "/api/links", { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(body) });
	const j = await res.json();
	if (!res.ok) throw new Error(j.error || "建立失敗");
	
	// 自動複製短網址到剪貼簿
	try {
		await navigator.clipboard.writeText(j.short);
		showToast("短網址建立成功並已複製到剪貼簿");
	} catch (clipErr) {
		showToast("短網址建立成功但是複製到剪貼簿失敗");
	}
	
	form.reset();
	
	// 重置後要再次禁用廣告秒數輸入框
	$("#interstitialSeconds").disabled = true;

	// Optimistic Update
	const existingIndex = allLinks.findIndex(item => item.code === j.code);
	if (existingIndex > -1) {
		allLinks[existingIndex] = j;
	} else {
		allLinks.push(j);
	}
	renderList();
	}
	catch(err){ 
		showToast("短網址建立失敗：" + err.message, 'error'); 
	}
}

function renderList() {
	const activeFilters = Array.from(document.querySelectorAll("#filters input:checked")).map(el => el.value);

	let filtered = allLinks.filter(item => activeFilters.includes(item.status));

	filtered.sort((a, b) => {
		let valA = a[currentSort.key];
		let valB = b[currentSort.key];
		if (valA === null || valA === undefined) valA = -Infinity;
		if (valB === null || valB === undefined) valB = -Infinity;

		let result = 0;
		if (valA < valB) result = -1;
		if (valA > valB) result = 1;

		return currentSort.dir === 'asc' ? result : -result;
	});

	// 分頁計算
	const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
	if (currentPage >= totalPages && totalPages > 0) currentPage = totalPages - 1;
	if (currentPage < 0) currentPage = 0;

	const startIdx = currentPage * PAGE_SIZE;
	const endIdx = Math.min(startIdx + PAGE_SIZE, filtered.length);
	const pageData = filtered.slice(startIdx, endIdx);

	tbody.innerHTML = "";
	countdownElements = []; // 清空倒數元素快取
	
	pageData.forEach(item => {
		const badgeClass = item.status==="active" ? "green" :
											 item.status==="expiring" ? "amber" :
											 item.status==="invalid" ? "gray" : "red";
		const isExpired = item.status === "expired";
		const isInvalid = item.status === "invalid";

		// 剩餘時間顯示邏輯
		let remainDisplay = "";
		let remainAttrs = "";
		if (isExpired) {
			remainDisplay = "已過期";
			remainAttrs = "";
		} else if (item.expiresAt == null) {
			remainDisplay = "N/A";
			remainAttrs = "";
		} else {
			remainDisplay = "";
			remainAttrs = \`data-expires-at="\${item.expiresAt}"\`;
		}

		const actionLabel = isExpired ? "已過期" : isInvalid ? "恢復有效" : "註銷";
		const actionAttrs = isExpired ? 'disabled aria-disabled="true" title="已過期不可操作"' : "";
		const actionClasses = isExpired ? "btn disabled:opacity-50" : isInvalid ? "btn btn-primary" : "btn";

		// ★ 禁用編輯（過期時不允許切換/輸入）
		const disabledAttr = isExpired ? 'disabled aria-disabled="true" title="已過期不可編輯"' : '';
		
		// ★ 格式化顯示用的 URL
		const isMobile = window.innerWidth < 768; // md breakpoint
		const displayUrl = fmtUrl(item.url, isMobile);

		const tr = document.createElement("tr");
		tr.innerHTML = \`
			<td class="border px-1 sm:px-2 py-1">
			<button class="link copy-short-link" data-short="\${base}/\${item.code}" style="background:none;border:none;padding:0;cursor:pointer;text-decoration:underline;text-underline-offset:2px;color:#1d4ed8" title="點擊複製短網址">\${item.code}</button>
		</td>
			<td class="border px-1 sm:px-2 py-1">
				<a class="link block" href="\${item.url}" target="_blank" title="\${item.url}" style="word-break:break-all;overflow-wrap:anywhere">\${displayUrl}</a>
			</td>
			<td class="border px-1 sm:px-2 py-1 lg:table-cell" style="display: none;">
				\${fmtTime(item.created)}
			</td>
			<td class="border px-1 sm:px-2 py-1 md:table-cell" style="display: none;">
				\${fmtTime(item.expiresAt)}
			</td>
			<td class="border px-1 sm:px-2 py-1"><span class="remain font-mono" \${remainAttrs}>\${remainDisplay}</span></td>
			<td class="border px-1 sm:px-2 py-1 text-center"><span class="badge \${badgeClass}" style="display:inline-block;min-width:70px;text-align:center">\${item.status}</span></td>

			<!-- ★ 插頁廣告顯示 -->
			<td class="border px-1 sm:px-2 py-1 text-center xl:table-cell" style="display: none;">
				\${item.interstitial_enabled ? '✅' : '❌'}
			</td>

			<!-- ★ 秒數顯示 -->
			<td class="border px-1 sm:px-2 py-1 text-center xl:table-cell" style="display: none;">
				\${item.interstitial_seconds != null ? item.interstitial_seconds + 's' : '-'}
			</td>

			<td class="border px-1 sm:px-2 py-1 text-center">
				<div class="flex gap-1 justify-center">
					<button data-code="\${item.code}" class="edit-interstitial-btn edit-icon p-1" title="編輯廣告" \${disabledAttr}>
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
							<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
						</svg>
					</button>
					<button data-code="\${item.code}" class="\${actionClasses} text-xs px-2 py-1" \${actionAttrs}>\${isExpired ? '過期' : isInvalid ? '恢復' : '註銷'}</button>
				</div>
			</td>\`;
		tbody.appendChild(tr);
		
		// ★ 如果有到期時間，加入倒數快取
		if (item.expiresAt != null && !isExpired) {
			const remainElement = tr.querySelector('.remain');
			if (remainElement) {
				countdownElements.push({
					element: remainElement,
					expiresAt: item.expiresAt
				});
			}
		}
	});

	// 更新分頁資訊
	listCount.textContent = \`共 \${allLinks.length} 筆，篩選後 \${filtered.length} 筆\`;
	pageInfo.textContent = \`第 \${currentPage + 1} / \${Math.max(1, totalPages)} 頁 (本頁 \${pageData.length} 筆)\`;

	btnPrev.disabled = currentPage === 0;
	btnNext.disabled = currentPage >= totalPages - 1 || totalPages === 0;

	// ★ 綁定編輯按鈕
	tbody.querySelectorAll(".edit-interstitial-btn").forEach(btn => {
		btn.addEventListener("click", () => {
			const code = btn.getAttribute("data-code");
			const item = allLinks.find(i => i.code === code);
			if (!item) return;
			
			editingCode = code;
			modalEnabled.checked = item.interstitial_enabled === true;
			
			// 設定廣告秒數：如果有值且大於0則顯示，否則顯示5（當啟用時）或空白（未啟用時）
			if (item.interstitial_seconds != null && item.interstitial_seconds > 0) {
				modalSeconds.value = item.interstitial_seconds;
			} else {
				modalSeconds.value = item.interstitial_enabled ? 5 : "";
			}
			
			// 設定 TTL（將秒數轉換為小時）
			if (item.ttl != null && item.ttl > 0) {
				modalTtlHours.value = Math.round(item.ttl / 3600);
			} else {
				modalTtlHours.value = "";
			}
			
			// 根據核取方塊狀態決定秒數輸入框是否可用
			modalSeconds.disabled = !modalEnabled.checked;
			if (modalEnabled.checked && (!modalSeconds.value || Number(modalSeconds.value) === 0)) {
				modalSeconds.value = 5;
			}
			
			editModal.style.display = "flex";
		});
	});

	// ★ 綁定複製短網址按鈕
	tbody.querySelectorAll(".copy-short-link").forEach(btn => {
		btn.addEventListener("click", async () => {
			const shortUrl = btn.getAttribute("data-short");
			if (!shortUrl) return;
			
			try {
				await navigator.clipboard.writeText(shortUrl);
				showToast("短網址已複製到剪貼簿");
			} catch (err) {
				showToast("複製失敗：" + err.message, 'error');
			}
		});
	});

	// ★ 綁定註銷/恢復按鈕
	tbody.querySelectorAll("button[data-code]:not([disabled]):not(.edit-interstitial-btn)").forEach(btn=>{
		btn.addEventListener("click", async ()=>{
			const code = btn.getAttribute("data-code");
			const action = btn.textContent?.includes("恢復") ? "restore" : "invalidate";
			const res = await fetch(base + "/api/links/" + encodeURIComponent(code), {
				method:"PATCH",
				headers:{ "content-type":"application/json" },
				body: JSON.stringify({ action })
			});
			if (!res.ok){ alert("操作失敗"); return; }
			const updatedItem = await res.json();
			
			// Optimistic update for toggle
			const idx = allLinks.findIndex(i => i.code === code);
			if(idx > -1 && updatedItem.status) {
				allLinks[idx].status = updatedItem.status;
				allLinks[idx].valid = updatedItem.valid;
			}
			renderList();
		});
	});

	startCountdown();
	updateResponsiveColumns(); // 更新響應式欄位
}

// ★ 對話框邏輯
modalEnabled.addEventListener("change", () => {
	if (modalEnabled.checked) {
		modalSeconds.disabled = false;
		if (!modalSeconds.value || Number(modalSeconds.value) === 0) {
			modalSeconds.value = 5;
		}
	} else {
		modalSeconds.disabled = true;
	}
});

modalCancel.addEventListener("click", () => {
	editModal.style.display = "none";
	editingCode = null;
});

modalSave.addEventListener("click", async () => {
	if (!editingCode) return;
	
	const enabled = modalEnabled.checked;
	const seconds = modalSeconds.value ? Number(modalSeconds.value) : null;
	const ttlHours = modalTtlHours.value ? Number(modalTtlHours.value) : null;
	
	if (enabled && (!seconds || seconds < 1)) {
		alert("啟用廣告時，秒數必須大於等於 1");
		return;
	}
	
	if (ttlHours !== null && ttlHours < 1) {
		alert("有效小時必須大於等於 1，或留空表示永久有效");
		return;
	}
	
	const payload = {
		interstitial_enabled: enabled,
		interstitial_seconds: enabled ? seconds : 0,  // 未啟用時設為 0
		ttl_hours: ttlHours  // null 表示永久
	};
	
	try {
		const res = await fetch(base + "/api/links/" + encodeURIComponent(editingCode), {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload)
		});
		
		if (!res.ok) {
			alert("更新失敗");
			return;
		}
		
		const updated = await res.json();
		const idx = allLinks.findIndex(i => i.code === editingCode);
		if (idx > -1) {
			allLinks[idx].interstitial_enabled = updated.interstitial_enabled;
			allLinks[idx].interstitial_seconds = updated.interstitial_seconds;
			// 更新 TTL 相關資訊
			if (updated.ttl !== undefined) allLinks[idx].ttl = updated.ttl;
			if (updated.expiresAt !== undefined) allLinks[idx].expiresAt = updated.expiresAt;
			if (updated.status !== undefined) allLinks[idx].status = updated.status;
			if (updated.remaining !== undefined) allLinks[idx].remaining = updated.remaining;
		}
		
		editModal.style.display = "none";
		editingCode = null;
		renderList();
	} catch (err) {
		alert("更新失敗：" + err.message);
	}
});

// 點擊對話框外部關閉
editModal.addEventListener("click", (e) => {
	if (e.target === editModal) {
		editModal.style.display = "none";
		editingCode = null;
	}
});

async function loadAllLinks(cursor = null) {
	const params = new URLSearchParams({ limit: "1000", expand: "1" });
	if (cursor) params.set("cursor", cursor);

	const res = await fetch(base + "/api/links?" + params.toString());
	const j = await res.json();

	if (j.items) {
		allLinks.push(...j.items);
	}

	if (!j.list_complete && j.cursor) {
		await loadAllLinks(j.cursor);
	}
}

async function init() {
	allLinks = [];
	currentPage = 0; // 重置到第一頁
	await loadAllLinks();
	renderList();
}

document.querySelectorAll("#filters input").forEach(el => {
	el.addEventListener("change", () => {
		currentPage = 0; // 篩選時重置到第一頁
		renderList();
	});
});

document.querySelectorAll("th[data-sort]").forEach(th => {
	th.addEventListener("click", () => {
		const key = th.getAttribute('data-sort');
		if (currentSort.key === key) {
			currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
		} else {
			currentSort.key = key;
			currentSort.dir = 'asc';
		}
		// 排序時保持在當前頁面
		renderList();
	});
});

btnPrev.addEventListener("click", () => {
	if (currentPage > 0) {
		currentPage--;
		renderList();
	}
});

btnNext.addEventListener("click", () => {
	currentPage++;
	renderList();
});

form.addEventListener("submit", createLink);
btnRefresh.addEventListener("click", init);
document.addEventListener("keydown", e=>{ if(e.key.toLowerCase()==="r") init(); });

// 監聽建立表單中的插頁廣告勾選
$("#useInterstitial").addEventListener("change", () => {
	const interstitialSecondsInput = $("#interstitialSeconds");
	if ($("#useInterstitial").checked) {
		interstitialSecondsInput.disabled = false;
		if (!interstitialSecondsInput.value || Number(interstitialSecondsInput.value) === 0) {
			interstitialSecondsInput.value = 5;
		}
	} else {
		interstitialSecondsInput.disabled = true;
		interstitialSecondsInput.value = "";
	}
});

// 監聽視窗大小變化
window.addEventListener('resize', () => {
	updateResponsiveColumns();
});

init();
</script>
</body></html>`;

/* 無效短網址頁 */
const INVALID_HTML = (host: string, code: string) => `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>短網址無效 - ${host}</title>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
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

/* 乾淨首頁：避免把根路徑當成後台 */
const ROOT_HTML = (author: string, contact: string) => `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Shortener</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
	<div style="max-width:720px;margin:4rem auto;text-align:center">
		<h1>URL Shortener</h1>
		<p>這裡沒有內容。</p>
        <p>別在探索的時候遺失了自我。</p>
	</div>
	<footer style="position:fixed;bottom:1rem;width:100%;text-align:center;font-size:.75rem;color:#888">
			<p>${author ? author : ""}</p>
			<p>${contact ? contact : ""}<p>
	</footer>
</body></html>`;

/* 未授權訪問頁面 */
const UNAUTHORIZED_HTML = (redirectUrl: string) => `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>未授權訪問</title>
<meta http-equiv="refresh" content="5;url=${redirectUrl}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:0;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{max-width:640px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px;text-align:center;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.icon{font-size:48px;margin-bottom:12px}
h1{font-size:24px;margin:0 0 12px;font-weight:600}
p{margin:8px 0;color:#64748b}
.countdown{font-weight:bold;color:#0f172a}
</style>
</head>
<body>
<div class="card">
<div class="icon">⛔</div>
<h1>這裡不是你該來的地方</h1>
<p>即將在 <span class="countdown" id="count">5</span> 秒後返回首頁...</p>
</div>
<script>
let sec=5;
const el=document.getElementById('count');
const t=setInterval(()=>{
sec--;
if(el)el.textContent=String(sec);
if(sec<=0){clearInterval(t);location.href='${redirectUrl}';}
},1000);
</script>
</body>
</html>`;

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		const url = new URL(req.url);
		const path = url.pathname.replace(/^\/+/, "");

		if (req.method === "GET" && (url.pathname === "/favicon.ico" || url.pathname === "/favicon.svg")) {
			return new Response(FAVICON_SVG, {
				headers: {
					"content-type": "image/svg+xml; charset=utf-8",
					"cache-control": "public, max-age=86400"
				}
			});
		}

		// 提供 Tailwind CSS 樣式文件
		if (req.method === "GET" && url.pathname === "/styles.css") {
			return new Response(STYLES_CSS, {
				headers: {
					"content-type": "text/css; charset=utf-8",
					"cache-control": "no-cache, no-store, must-revalidate"
				}
			});
		}

		// 僅 /admin 提供管理頁
		if (req.method === "GET" && path === "admin") {
			return new Response(ADMIN_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
		}

		if (req.method === "GET" && path === "") {
			const author = env.AUTHOR ?? "";
			const contact = env.CONTACT ?? "";
			return new Response(ROOT_HTML(author, contact), {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		}

		// 建立：POST /api/links
		if (req.method === "POST" && path === "api/links") {
			const body = (await getBody(req)) as {
				url?: string;
				code?: string;
				ttl_hours?: number | string;
				ttl?: number | string;
				interstitial_enabled?: boolean;
				interstitial_seconds?: number | string;
			};
			const longUrl = normalizeUrl(body.url);
			if (!longUrl) return json({ error: "invalid url" }, 400);

			let code = body.code?.trim();

			if (code) { // 使用自訂 code
				if (!/^[\w-]{3,64}$/.test(code)) return json({ error: "invalid code format" }, 400);
				const existing = await env.LINKS.get(code);
				if (existing) return json({ error: "code already in use" }, 409);
			} else { // 自動產生 code
				let retries = 5;
				let unique = false;
				do {
					code = genCode(6);
					const existing = await env.LINKS.get(code);
					if (!existing) {
						unique = true;
						break;
					}
					retries--;
				} while (retries > 0);
				if (!unique) return json({ error: "failed to generate a unique code" }, 500);
			}

			// 處理插頁廣告秒數：如果啟用但沒有傳秒數，預設為5；未啟用則設為0
			let interstitialSeconds = 0;
			if (body.interstitial_enabled) {
				if (body.interstitial_seconds && Number(body.interstitial_seconds) > 0) {
					interstitialSeconds = Number(body.interstitial_seconds);
				} else {
					interstitialSeconds = 5;
				}
			}

			let ttlSec: number | undefined;
			if (body.ttl_hours !== undefined && String(body.ttl_hours) !== "") {
				const hours = Number(body.ttl_hours);
				if (!Number.isFinite(hours) || hours <= 0) return json({ error: "invalid ttl_hours" }, 400);
				ttlSec = Math.round(hours * 3600);
			} else if (body.ttl !== undefined && String(body.ttl) !== "") {
				const ttl = Number(body.ttl);
				if (!Number.isFinite(ttl) || ttl <= 0) return json({ error: "invalid ttl" }, 400);
				ttlSec = Math.round(ttl);
			}

			const payload: KVValue = {
				url: longUrl,
				created: nowSec(),
				ttl: ttlSec,
				valid: true,
				interstitial_enabled: String(body.interstitial_enabled ?? "") === "true" || body.interstitial_enabled === true,
				interstitial_seconds: interstitialSeconds,
			};
			await env.LINKS.put(code, JSON.stringify(payload));
			const meta = computeMeta(payload);
			return json({
				code, short: `${url.origin}/${code}`, url: longUrl,
				ttl: payload.ttl ?? null, created: payload.created,
				expiresAt: meta.expiresAt, status: meta.status, remaining: meta.remaining,
				interstitial_enabled: payload.interstitial_enabled,
				interstitial_seconds: payload.interstitial_seconds,
			});
		}

		// 讀單筆：GET /api/links/:code
		if (req.method === "GET" && path.startsWith("api/links/")) {
			const code = path.split("/").pop() || "";
			if (!code) return json({ error: "invalid code" }, 400);
			const raw = await env.LINKS.get(code, { type: "text" });
			if (!raw) return json({ error: "not found" }, 404);
			let v: KVValue | null = null;
			try { v = JSON.parse(raw) as KVValue; } catch { v = null; }
			if (!v?.url) return json({ error: "not found" }, 404);
			const meta = computeMeta(v);
			return json({
				code, url: v.url, ttl: v.ttl ?? null, created: v.created,
				expiresAt: meta.expiresAt, status: meta.status, remaining: meta.remaining,
				valid: v.valid !== false,
				interstitial_enabled: v.interstitial_enabled,
				interstitial_seconds: v.interstitial_seconds ?? null
			});
		}

		// 列表：GET /api/links?limit=&cursor=&expand=1
		if (req.method === "GET" && path === "api/links") {
			const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit") || "100")));
			const cursor = url.searchParams.get("cursor") || undefined;
			const expand = url.searchParams.get("expand") === "1";
			const list = await env.LINKS.list({ limit, cursor }) as KVListResult;
			let items: ListedItem[] = list.keys.map((k) => ({ code: k.name }));
			if (expand && items.length) {
				items = await Promise.all(items.map(async (it) => {
					const raw = await env.LINKS.get(it.code, { type: "text" });
					if (!raw) return { code: it.code, status: "expired" as const };
					let v: KVValue | null = null;
					try { v = JSON.parse(raw) as KVValue; } catch { v = null; }
					if (!v?.url) return { code: it.code, status: "expired" as const };
					const meta = computeMeta(v);
					return {
						code: it.code, url: v.url, created: v.created,
						ttl: v.ttl ?? null, expiresAt: meta.expiresAt,
						status: meta.status, remaining: meta.remaining,
						interstitial_enabled: v.interstitial_enabled ?? false,
						interstitial_seconds: v.interstitial_seconds ?? null
					};
				}));
			}
			return json({ items, cursor: list.cursor || null, list_complete: list.list_complete });
		}

		// 註銷/恢復 + 更新插頁廣告設定 + 更新到期時間：PATCH /api/links/:code
		if (req.method === "PATCH" && path.startsWith("api/links/")) {
			const code = path.split("/").pop() || "";
			if (!code) return json({ error: "invalid code" }, 400);

			const raw = await env.LINKS.get(code, { type: "text" });
			if (!raw) return json({ error: "not found" }, 404);

			let v: KVValue | null = null;
			try { v = JSON.parse(raw) as KVValue; } catch { v = null; }
			if (!v?.url) return json({ error: "not found" }, 404);

			const body = (await getBody(req)) as {
				action?: "invalidate" | "restore";
				interstitial_enabled?: boolean | string;
				interstitial_seconds?: number | string | null;
				ttl_hours?: number | string | null;
			};

			// 1) 作廢/恢復
			if (body.action === "invalidate") v.valid = false;
			else if (body.action === "restore") v.valid = true;
			else if (body.action != null) return json({ error: "invalid action" }, 400);

			// 2) 插頁廣告設定（可單獨送或和 action 一起送）
			const hasToggle =
				typeof body.interstitial_enabled !== "undefined" &&
				body.interstitial_enabled !== "";

			const hasSeconds =
				typeof body.interstitial_seconds !== "undefined";

			if (hasToggle || hasSeconds) {
				// 初始化結構
				if (!v.interstitial_enabled) v.interstitial_enabled = false;
				// enabled：接受 "true"/"false" 或 boolean
				if (hasToggle) {
					const enabled =
						body.interstitial_enabled === true ||
						String(body.interstitial_enabled).toLowerCase() === "true";
					v.interstitial_enabled = enabled;
				}
				// seconds：接受 number、字串數字；null/空字串代表設為 0
				if (hasSeconds) {
					if (body.interstitial_seconds === null || body.interstitial_seconds === "") {
						// 設為 0 而不是刪除
						v.interstitial_seconds = 0;
					} else {
						const secNum = Number(body.interstitial_seconds);
						if (!Number.isFinite(secNum) || secNum < 0) {
							return json({ error: "invalid interstitial_seconds" }, 400);
						}
						v.interstitial_seconds = Math.floor(secNum);
					}
				}
			}

			// 3) 更新 TTL（到期時間）
			if (typeof body.ttl_hours !== "undefined") {
				if (body.ttl_hours === null || body.ttl_hours === "") {
					// 設為永久
					v.ttl = undefined;
				} else {
					const hours = Number(body.ttl_hours);
					if (!Number.isFinite(hours) || hours <= 0) {
						return json({ error: "invalid ttl_hours" }, 400);
					}
					// 更新 TTL 時，從現在開始重新計算
					v.ttl = Math.round(hours * 3600);
					v.created = nowSec();  // 重設建立時間為現在
				}
			}

			await env.LINKS.put(code, JSON.stringify(v));
			const meta = computeMeta(v);
			return json({
				ok: true,
				code,
				status: meta.status,
				valid: v.valid !== false,
				interstitial_enabled: v.interstitial_enabled ?? false,
				interstitial_seconds: (v.interstitial_seconds ?? null),
				ttl: v.ttl ?? null,
				expiresAt: meta.expiresAt,
				remaining: meta.remaining,
			});
		} if (req.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: {
					"access-control-allow-origin": "*",
					"access-control-allow-headers": "authorization,content-type,cf-access-client-id,cf-access-client-secret",
					"access-control-allow-methods": "GET,POST,DELETE,OPTIONS,PATCH",
					"access-control-max-age": "86400",
				},
			});
		}

		// 處理短連結重導向：GET /:code
		if (req.method === "GET" && path && !path.includes("/")) {
			const code = path;
			const raw = await env.LINKS.get(code, { type: "text" });
			if (!raw) {
				return new Response(INVALID_HTML(url.host, code), {
					status: 404,
					headers: { "content-type": "text/html; charset=utf-8" }
				});
			}

			let v: KVValue | null = null;
			try { v = JSON.parse(raw) as KVValue; } catch { v = null; }
			if (!v?.url) {
				return new Response(INVALID_HTML(url.host, code), {
					status: 404,
					headers: { "content-type": "text/html; charset=utf-8" }
				});
			}

			const meta = computeMeta(v);
			if (meta.status === "expired" || v.valid === false) {
				return new Response(INVALID_HTML(url.host, code), {
					status: 410,
					headers: { "content-type": "text/html; charset=utf-8" }
				});
			}

			// 如果啟用插頁廣告，顯示插頁廣告頁面
			if (v.interstitial_enabled && v.interstitial_seconds && v.interstitial_seconds > 0) {
				const interstitialHTML = renderInterstitialHTML(v.url, {
					seconds: v.interstitial_seconds
				});
				return new Response(interstitialHTML, {
					headers: { "content-type": "text/html; charset=utf-8" }
				});
			}

			// 直接重導向
			return Response.redirect(v.url, 302);
		}

		// 404 - 顯示未授權訪問頁面並跳轉到首頁
		return new Response(UNAUTHORIZED_HTML(url.origin + "/"), {
			status: 404,
			headers: { "content-type": "text/html; charset=utf-8" }
		});
	},
} satisfies ExportedHandler<Env>;