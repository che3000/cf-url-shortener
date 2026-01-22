// Admin page client-side JavaScript
// Exported as plain string to avoid template literal escaping issues

export const ADMIN_CLIENT_JS = String.raw`
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
let editingCode = null;
let countdownElements = [];
let isLoading = false;
const sortKeyMap = {
	interstitial: "interstitial_enabled",
	interstitialSeconds: "interstitial_seconds"
};

const showToast = (message, type = 'success') => {
	const existingToast = document.querySelector('.toast');
	if (existingToast) {
		existingToast.remove();
	}
	
	const icon = type === 'success' 
		? '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
		: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
	
	const toast = document.createElement('div');
	toast.className = 'toast ' + type;
	toast.innerHTML = icon + '<span>' + message + '</span>';
	document.body.appendChild(toast);
	
	setTimeout(() => {
		toast.classList.add('hide');
		setTimeout(() => {
			toast.remove();
		}, 300);
	}, 2500);
};

const updateResponsiveColumns = () => {
	const width = window.innerWidth;
	
	const createdCells = document.querySelectorAll('th[data-sort="created"], tbody td:nth-child(3)');
	createdCells.forEach((el) => {
		el.style.display = width >= 1024 ? 'table-cell' : 'none';
	});
	
	const expiresCells = document.querySelectorAll('th[data-sort="expiresAt"], tbody td:nth-child(4)');
	expiresCells.forEach((el) => {
		el.style.display = width >= 768 ? 'table-cell' : 'none';
	});
	
	const adCells = document.querySelectorAll('th[data-sort="interstitial"], tbody td:nth-child(7)');
	adCells.forEach((el) => {
		el.style.display = width >= 1280 ? 'table-cell' : 'none';
	});
	
	const secondsCells = document.querySelectorAll('th[data-sort="interstitialSeconds"], tbody td:nth-child(8)');
	secondsCells.forEach((el) => {
		el.style.display = width >= 1280 ? 'table-cell' : 'none';
	});
};

const fmt = (sec)=>{
	if (sec == null) return "N/A";
	const s = Math.max(0, Math.floor(sec));
	const h = Math.floor(s/3600), m=Math.floor((s%3600)/60), r=s%60;
	if (h) return h + 'h ' + m + 'm ' + r + 's';
	if (m) return m + 'm ' + r + 's';
	return r + 's';
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
	return year + '/' + month + '/' + day + ' ' + hours + ':' + minutes + ':' + seconds;
};

const fmtUrl = (url, isMobile = false) => {
	if (!url) return '';
	if (!isMobile) {
		// 桌面版：限制最多顯示 40 個字元
		if (url.length > 40) {
			return url.substring(0, 40) + '...';
		}
		return url;
	}
	let cleaned = url.replace(/^https?:\/\//, '');
	cleaned = cleaned.replace(/^www\./, '');
	cleaned = cleaned.replace(/\/$/, '');
	
	// 手機版：限制最多顯示 25 個字元
	if (cleaned.length > 25) {
		return cleaned.substring(0, 25) + '...';
	}
	
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
	const res = await fetch(base + "/admin/api/links", { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(body) });
	const j = await res.json();
	if (!res.ok) throw new Error(j.error || "建立失敗");
	
	try {
		await navigator.clipboard.writeText(j.short);
		showToast("短網址建立成功並已複製到剪貼簿");
	} catch (clipErr) {
		showToast("短網址建立成功但是複製到剪貼簿失敗");
	}
	
	form.reset();
	
	$("#interstitialSeconds").disabled = true;

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
		const sortKey = sortKeyMap[currentSort.key] || currentSort.key;
		let valA = a[sortKey];
		let valB = b[sortKey];
		if (typeof valA === "boolean") valA = valA ? 1 : 0;
		if (typeof valB === "boolean") valB = valB ? 1 : 0;
		if (valA === null || valA === undefined) valA = -Infinity;
		if (valB === null || valB === undefined) valB = -Infinity;

		let result = 0;
		if (valA < valB) result = -1;
		if (valA > valB) result = 1;

		return currentSort.dir === 'asc' ? result : -result;
	});

	const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
	if (currentPage >= totalPages && totalPages > 0) currentPage = totalPages - 1;
	if (currentPage < 0) currentPage = 0;

	const startIdx = currentPage * PAGE_SIZE;
	const endIdx = Math.min(startIdx + PAGE_SIZE, filtered.length);
	const pageData = filtered.slice(startIdx, endIdx);

	tbody.innerHTML = "";
	countdownElements = [];
	
	pageData.forEach(item => {
		const badgeClass = item.status==="active" ? "green" :
											 item.status==="expiring" ? "amber" :
											 item.status==="invalid" ? "gray" : "red";
		const isExpired = item.status === "expired";
		const isInvalid = item.status === "invalid";

		let remainDisplay = "";
		let remainAttrs = "";
		if (isExpired) {
			remainDisplay = "已過期";
			remainAttrs = "";
		} else if (item.expiresAt == null) {
			remainDisplay = "N/A";
			remainAttrs = "";
		} else {
			// 計算初始剩餘時間，避免空白閃爍
			const now = Math.floor(Date.now() / 1000);
			const left = Math.max(0, item.expiresAt - now);
			remainDisplay = fmt(left);
			remainAttrs = 'data-expires-at="' + item.expiresAt + '"';
		}

		const actionAttrs = isExpired ? 'disabled aria-disabled="true" title="已過期不可操作"' : "";
		const actionClasses = isExpired ? "btn disabled:opacity-50" : isInvalid ? "btn btn-primary" : "btn";

		// 允許編輯已過期的短網址（可延長 TTL 或調整設定）
		const disabledAttr = '';
		
		const isMobile = window.innerWidth < 768;
		const displayUrl = fmtUrl(item.url, isMobile);

		const tr = document.createElement("tr");
		tr.innerHTML = '<td class="border px-1 sm:px-2 py-1">' +
			'<button class="link copy-short-link" data-short="' + base + '/' + item.code + '" style="background:none;border:none;padding:0;cursor:pointer;text-decoration:underline;text-underline-offset:2px;color:#1d4ed8" title="點擊複製短網址">' + item.code + '</button>' +
			'</td>' +
			'<td class="border px-1 sm:px-2 py-1">' +
				'<a class="link block" href="' + item.url + '" target="_blank" title="' + item.url + '" style="word-break:break-all;overflow-wrap:anywhere">' + displayUrl + '</a>' +
			'</td>' +
			'<td class="border px-1 sm:px-2 py-1 lg:table-cell" style="display: none;">' +
				fmtTime(item.created) +
			'</td>' +
			'<td class="border px-1 sm:px-2 py-1 md:table-cell" style="display: none;">' +
				fmtTime(item.expiresAt) +
			'</td>' +
			'<td class="border px-1 sm:px-2 py-1"><span class="remain font-mono" ' + remainAttrs + '>' + remainDisplay + '</span></td>' +
			'<td class="border px-1 sm:px-2 py-1 text-center"><span class="badge ' + badgeClass + '" style="display:inline-block;min-width:70px;text-align:center">' + item.status + '</span></td>' +
			'<td class="border px-1 sm:px-2 py-1 text-center xl:table-cell" style="display: none;">' +
				(item.interstitial_enabled ? '✅' : '❌') +
			'</td>' +
			'<td class="border px-1 sm:px-2 py-1 text-center xl:table-cell" style="display: none;">' +
				(item.interstitial_seconds != null ? item.interstitial_seconds + 's' : '-') +
			'</td>' +
			'<td class="border px-1 sm:px-2 py-1 text-center">' +
				'<div class="flex gap-1 justify-center">' +
					'<button data-code="' + item.code + '" class="edit-interstitial-btn edit-icon p-1" title="編輯廣告" ' + disabledAttr + '>' +
						'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
							'<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>' +
							'<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>' +
						'</svg>' +
					'</button>' +
					'<button data-code="' + item.code + '" class="' + actionClasses + ' text-xs px-2 py-1" ' + actionAttrs + '>' + (isExpired ? '過期' : isInvalid ? '啟用' : '註銷') + '</button>' +
				'</div>' +
			'</td>';
		tbody.appendChild(tr);
		
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

	listCount.textContent = '共 ' + allLinks.length + ' 筆，篩選後 ' + filtered.length + ' 筆';
	pageInfo.textContent = '第 ' + (currentPage + 1) + ' / ' + Math.max(1, totalPages) + ' 頁 (本頁 ' + pageData.length + ' 筆)';

	btnPrev.disabled = currentPage === 0;
	btnNext.disabled = currentPage >= totalPages - 1 || totalPages === 0;

	tbody.querySelectorAll(".edit-interstitial-btn").forEach(btn => {
		btn.addEventListener("click", () => {
			const code = btn.getAttribute("data-code");
			const item = allLinks.find(i => i.code === code);
			if (!item) return;
			
			editingCode = code;
			modalEnabled.checked = item.interstitial_enabled === true;
			
			if (item.interstitial_seconds != null && item.interstitial_seconds > 0) {
				modalSeconds.value = item.interstitial_seconds;
			} else {
				modalSeconds.value = item.interstitial_enabled ? 5 : "";
			}
			
			if (item.ttl != null && item.ttl > 0) {
				modalTtlHours.value = Math.round(item.ttl / 3600);
			} else {
				modalTtlHours.value = "";
			}
			
			modalSeconds.disabled = !modalEnabled.checked;
			if (modalEnabled.checked && (!modalSeconds.value || Number(modalSeconds.value) === 0)) {
				modalSeconds.value = 5;
			}
			
			editModal.style.display = "flex";
		});
	});

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

	tbody.querySelectorAll("button[data-code]:not([disabled]):not(.edit-interstitial-btn)").forEach(btn=>{
		btn.addEventListener("click", async ()=>{
			const code = btn.getAttribute("data-code");
			const action = btn.textContent?.includes("啟用") ? "restore" : "invalidate";
			const actionText = action === "restore" ? "啟用" : "註銷";
			
			try {
				const res = await fetch(base + "/admin/api/links/" + encodeURIComponent(code), {
					method:"PATCH",
					headers:{ "content-type":"application/json" },
					body: JSON.stringify({ action })
				});
				
				if (!res.ok) {
					showToast(actionText + '失敗', 'error');
					return;
				}
				
				const updatedItem = await res.json();
				
				const idx = allLinks.findIndex(i => i.code === code);
				if(idx > -1 && updatedItem.status) {
					allLinks[idx].status = updatedItem.status;
					allLinks[idx].valid = updatedItem.valid;
				}
				
				showToast('短網址已' + actionText);
				renderList();
			} catch (err) {
				showToast(actionText + '失敗：' + err.message, 'error');
			}
		});
	});

	startCountdown();
	updateResponsiveColumns();
}

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
		showToast("啟用廣告時，秒數必須大於等於 1", 'error');
		return;
	}
	
	if (ttlHours !== null && ttlHours < 1) {
		showToast("有效小時必須大於等於 1，或留空表示永久有效", 'error');
		return;
	}
	
	const payload = {
		interstitial_enabled: enabled,
		interstitial_seconds: enabled ? seconds : 0,
		ttl_hours: ttlHours
	};
	
	try {
		const res = await fetch(base + "/admin/api/links/" + encodeURIComponent(editingCode), {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload)
		});
		
		if (!res.ok) {
			showToast("更新失敗", 'error');
			return;
		}
		
		const updated = await res.json();
		const idx = allLinks.findIndex(i => i.code === editingCode);
		if (idx > -1) {
			if (updated.interstitial_enabled !== undefined) allLinks[idx].interstitial_enabled = updated.interstitial_enabled;
			if (updated.interstitial_seconds !== undefined) allLinks[idx].interstitial_seconds = updated.interstitial_seconds;
			if (updated.ttl !== undefined) allLinks[idx].ttl = updated.ttl;
			if (updated.created !== undefined) allLinks[idx].created = updated.created;
			if (updated.expiresAt !== undefined) allLinks[idx].expiresAt = updated.expiresAt;
			if (updated.status !== undefined) allLinks[idx].status = updated.status;
			if (updated.remaining !== undefined) allLinks[idx].remaining = updated.remaining;
		}
		
		editModal.style.display = "none";
		editingCode = null;
		showToast("短網址設定更新成功");
		renderList();
	} catch (err) {
		showToast("更新失敗：" + err.message, 'error');
	}
});

editModal.addEventListener("click", (e) => {
	if (e.target === editModal) {
		editModal.style.display = "none";
		editingCode = null;
	}
});

async function loadAllLinks(cursor = null) {
	const params = new URLSearchParams({ limit: "1000", expand: "1" });
	if (cursor) params.set("cursor", cursor);

	const res = await fetch(base + "/admin/api/links?" + params.toString());
	const j = await res.json();

	if (j.items) {
		allLinks.push(...j.items);
	}

	if (!j.list_complete && j.cursor) {
		await loadAllLinks(j.cursor);
	}
}

async function init() {
	if (isLoading) {
		showToast("正在載入中，請稍候...", 'error');
		return;
	}
	
	isLoading = true;
	btnRefresh.disabled = true;
	
	try {
		allLinks = [];
		currentPage = 0;
		await loadAllLinks();
		renderList();
		showToast("資料已更新");
	} catch (err) {
		showToast("載入失敗：" + err.message, 'error');
	} finally {
		isLoading = false;
		btnRefresh.disabled = false;
	}
}

document.querySelectorAll("#filters input").forEach(el => {
	el.addEventListener("change", () => {
		currentPage = 0;
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

window.addEventListener('resize', () => {
	updateResponsiveColumns();
});

init();
`;
