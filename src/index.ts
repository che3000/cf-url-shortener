// Cloudflare Workers - URL Shortener (hours TTL + soft delete + improved UI & security)

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
<title>URL Shortener Admin Page</title>
<script src="https://cdn.tailwindcss.com"></script>
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
</style>
</head>
<body class="bg-slate-50">
  <div class="max-w-6xl mx-auto p-6 space-y-6">
    <header>
      <h1 class="text-2xl font-semibold tracking-tight">URL Shortener Admin Page</h1>
      <p class="text-slate-600">已由 Cloudflare Access 保護</p>
    </header>

    <section class="card p-5">
      <h2 class="text-lg font-medium mb-3">建立短網址</h2>
      <form id="create-form" class="grid md:grid-cols-4 gap-3 items-end">
        <div class="md:col-span-2">
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
        <div class="md:col-span-4">
          <button class="btn btn-primary">建立</button>
          <span id="create-msg" class="ml-3 text-sm"></span>
        </div>
      </form>
    </section>

    <section class="card p-5">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-lg font-medium">短網址清單</h2>
        <div id="filters" class="flex items-center gap-4 text-sm">
          <label class="flex items-center gap-1.5"><input type="checkbox" value="active" checked> 有效</label>
          <label class="flex items-center gap-1.5"><input type="checkbox" value="expiring" checked> 即將到期</label>
          <label class="flex items-center gap-1.5"><input type="checkbox" value="expired"> 已過期</label>
          <label class="flex items-center gap-1.5"><input type="checkbox" value="invalid" checked> 無效</label>
        </div>
        <div class="text-sm text-slate-600 flex items-center gap-2">
          <span id="list-count"></span>
          <button id="refresh" class="btn">重新整理 <span class="kbd">R</span></button>
        </div>
      </div>
      <div class="overflow-auto">
        <table class="min-w-full border text-sm">
          <thead class="bg-slate-100">
            <tr>
              <th data-sort="code" class="border px-2 py-1 text-left">短網址 ⇅</th>
              <th data-sort="url" class="border px-2 py-1 text-left">原始網址 ⇅</th>
              <th data-sort="created" class="border px-2 py-1 text-left">建立時間 ⇅</th>
              <th data-sort="expiresAt" class="border px-2 py-1 text-left">到期時間 ⇅</th>
              <th data-sort="remaining" class="border px-2 py-1 text-left">剩餘時間 ⇅</th>
              <th data-sort="status" class="border px-2 py-1 text-left">狀態 ⇅</th>
              <th class="border px-2 py-1 text-center">動作</th>
            </tr>
          </thead>
          <tbody id="list-body"></tbody>
        </table>
      </div>
      <div class="mt-3 flex items-center gap-2">
        <button id="prev" class="btn disabled:opacity-50" disabled>上一頁</button>
        <button id="next" class="btn disabled:opacity-50" disabled>下一頁</button>
        <span id="page-info" class="text-slate-600 text-sm"></span>
      </div>
    </section>
  </div>

<script>
const base = location.origin;
const $ = (s)=>document.querySelector(s);
const form = $("#create-form"), msg=$("#create-msg"), tbody=$("#list-body");
const btnRefresh=$("#refresh"), listCount=$("#list-count");
const btnPrev=$("#prev"), btnNext=$("#next"), pageInfo=$("#page-info");

let allLinks = [], countdownTimer = null;
let currentSort = { key: 'created', dir: 'asc' };
let currentPage = 0;
const PAGE_SIZE = 100;

const fmt = (sec)=>{
  if (sec == null) return "N/A";
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s/3600), m=Math.floor((s%3600)/60), r=s%60;
  if (h) return \`\${h}h \${m}m \${r}s\`;
  if (m) return \`\${m}m \${r}s\`;
  return \`\${r}s\`;
};
const fmtTime = (t)=> t ? new Date(t*1000).toLocaleString() : "永久";

function startCountdown(){
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(()=>{
    document.querySelectorAll(".remain").forEach(el=>{
      const hasAttr = el.hasAttribute("data-remaining");
      if (!hasAttr) return; // 沒有 data-remaining 屬性就不更新（保持原有文字，如「已過期」或「N/A」）
      const remain = Number(el.getAttribute("data-remaining"));
      const start = Number(el.getAttribute("data-start")) || 0;
      if (!Number.isFinite(remain)) { el.textContent = "—"; return; }
      const elapsed = Math.floor((Date.now()-start)/1000);
      const left = Math.max(0, remain - elapsed);
      el.textContent = fmt(left);
    });
  }, 1000);
}

async function createLink(e){
  e.preventDefault();
  msg.textContent = "建立中...";
  try{
    const ttlHoursStr = $("#ttlHours").value.trim();
    const ttl_hours = ttlHoursStr ? Number(ttlHoursStr) : undefined;
    const body = { url: $("#url").value.trim(), ttl_hours, code: $("#code").value.trim() || undefined };
    const res = await fetch(base + "/api/links", { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || "建立失敗");
    msg.textContent = "✅ 成功：" + j.short;
    form.reset();
    
    // Optimistic Update
    const existingIndex = allLinks.findIndex(item => item.code === j.code);
    if (existingIndex > -1) {
      allLinks[existingIndex] = j;
    } else {
      allLinks.push(j);
    }
    renderList();

  }catch(err){ msg.textContent = "❌ " + err.message; }
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
    } else if (item.remaining == null) {
      remainDisplay = "N/A";
      remainAttrs = "";
    } else {
      remainDisplay = "";
      remainAttrs = \`data-remaining="\${item.remaining}" data-start="\${Date.now()}"\`;
    }
    
    const actionLabel = isExpired ? "已過期" : isInvalid ? "恢復有效" : "註銷";
    const actionAttrs = isExpired ? 'disabled aria-disabled="true" title="已過期不可操作"' : "";
    const actionClasses = isExpired ? "btn disabled:opacity-50" : isInvalid ? "btn btn-primary" : "btn";

    const tr = document.createElement("tr");
    tr.innerHTML = \`
      <td class="border px-2 py-1"><a class="link" href="\${base}/\${item.code}" target="_blank">\${item.code}</a></td>
      <td class="border px-2 py-1 break-all"><a class="link" href="\${item.url}" target="_blank">\${item.url}</a></td>
      <td class="border px-2 py-1">\${fmtTime(item.created)}</td>
      <td class="border px-2 py-1">\${fmtTime(item.expiresAt)}</td>
      <td class="border px-2 py-1"><span class="remain font-mono" \${remainAttrs}>\${remainDisplay}</span></td>
      <td class="border px-2 py-1"><span class="badge \${badgeClass}">\${item.status}</span></td>
      <td class="border px-2 py-1 text-center">
        <button data-code="\${item.code}" class="\${actionClasses}" \${actionAttrs}>\${actionLabel}</button>
      </td>\`;
    tbody.appendChild(tr);
  });

  // 更新分頁資訊
  listCount.textContent = \`共 \${allLinks.length} 筆，篩選後 \${filtered.length} 筆\`;
  pageInfo.textContent = \`第 \${currentPage + 1} / \${Math.max(1, totalPages)} 頁 (本頁 \${pageData.length} 筆)\`;
  
  btnPrev.disabled = currentPage === 0;
  btnNext.disabled = currentPage >= totalPages - 1 || totalPages === 0;

  tbody.querySelectorAll("button[data-code]:not([disabled])").forEach(btn=>{
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
}

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

init();
</script>
</body></html>`;

/* 無效短碼頁 */
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
  </div>
  <footer style="position:fixed;bottom:1rem;width:100%;text-align:center;font-size:.75rem;color:#888">
      <p>${author ? author : ""}</p>
      <p>${contact ? contact : ""}<p>
  </footer>
</body></html>`;

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

    // 建立：POST /api/links  { url, code?, ttl_hours? }
    if (req.method === "POST" && path === "api/links") {
      const body = (await getBody(req)) as { url?: string; code?: string; ttl_hours?: number | string; ttl?: number | string };
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

      const payload: KVValue = { url: longUrl, created: nowSec(), ttl: ttlSec, valid: true };
      await env.LINKS.put(code, JSON.stringify(payload));
      const meta = computeMeta(payload);
      return json({
        code, short: `${url.origin}/${code}`, url: longUrl,
        ttl: payload.ttl ?? null, created: payload.created,
        expiresAt: meta.expiresAt, status: meta.status, remaining: meta.remaining
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
        valid: v.valid !== false
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
            status: meta.status, remaining: meta.remaining
          };
        }));
      }
      return json({ items, cursor: list.cursor || null, list_complete: list.list_complete });
    }

    //註銷/恢復：PATCH /api/links/:code  { action: "invalidate" | "restore" }
    if (req.method === "PATCH" && path.startsWith("api/links/")) {
      const code = path.split("/").pop() || "";
      if (!code) return json({ error: "invalid code" }, 400);
      const raw = await env.LINKS.get(code, { type: "text" });
      if (!raw) return json({ error: "not found" }, 404);
      let v: KVValue | null = null;
      try { v = JSON.parse(raw) as KVValue; } catch { v = null; }
      if (!v?.url) return json({ error: "not found" }, 404);

      const body = (await getBody(req)) as { action?: string };
      if (body.action === "invalidate") v.valid = false;
      else if (body.action === "restore") v.valid = true;
      else return json({ error: "invalid action" }, 400);

      await env.LINKS.put(code, JSON.stringify(v));
      const meta = computeMeta(v);
      return json({ ok: true, code, status: meta.status, valid: v.valid !== false });
    }

    // 跳轉（public）
    if (req.method === "GET" && path) {
      const raw = await env.LINKS.get(path, { type: "text" });
      if (raw) {
        try {
          const v = JSON.parse(raw) as KVValue;
          const meta = computeMeta(v);
          if (meta.status !== "expired" && meta.status !== "invalid" && v.url) {
            return Response.redirect(v.url, 301);
          }
        } catch {
          if (/^https?:\/\//.test(raw)) return Response.redirect(raw, 301);
        }
      }
      return new Response(INVALID_HTML(url.host, path), { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (req.method === "OPTIONS") {
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

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;