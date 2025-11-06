// Cloudflare Workers - URL Shortener (hours TTL + soft delete + improved UI & security)

import { renderInterstitialHTML } from "./interstitial";
import { STYLES_CSS } from "./styles/styles-inline";
import { renderAdminHTML } from "./templates/admin.html.js";
import { renderInvalidHTML } from "./templates/invalid.html.js";
import { renderRootHTML } from "./templates/root.html.js";
import { renderUnauthorizedHTML } from "./templates/unauthorized.html.js";

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
};

type KVListResult = {
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
};

type ListedItem = {
    code: string; 	// 短網址代碼
    url?: string; 	// 原始網址
    created?: number; // 建立時間（epoch seconds）
    ttl?: number | null; // 有效秒數
    expiresAt?: number | null; // 到期時間（epoch seconds）
    status?: "active" | "expiring" | "expired" | "invalid"; // 短網址狀態
    interstitial_enabled?: boolean; // 廣告開啟狀態
    interstitial_seconds?: number | null; // 廣告秒數
    remaining?: number | null; // 剩餘時間（秒）
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
            return new Response(renderAdminHTML(), { headers: { "content-type": "text/html; charset=utf-8" } });
        }

        if (req.method === "GET" && path === "") {
            const author = env.AUTHOR ?? "";
            const contact = env.CONTACT ?? "";
            return new Response(renderRootHTML(author, contact), {
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

        // 註銷/啟用 + 更新插頁廣告設定 + 更新到期時間：PATCH /api/links/:code
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

            // 1) 作廢/啟用
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

        // 處理短連結重導向：GET /:code
        if (req.method === "GET" && path && !path.includes("/")) {
            const code = path;
            const raw = await env.LINKS.get(code, { type: "text" });
            if (!raw) {
                return new Response(renderInvalidHTML(url.host, code), {
                    status: 404,
                    headers: { "content-type": "text/html; charset=utf-8" }
                });
            }

            let v: KVValue | null = null;
            try { v = JSON.parse(raw) as KVValue; } catch { v = null; }
            if (!v?.url) {
                return new Response(renderInvalidHTML(url.host, code), {
                    status: 404,
                    headers: { "content-type": "text/html; charset=utf-8" }
                });
            }

            const meta = computeMeta(v);
            if (meta.status === "expired" || v.valid === false) {
                return new Response(renderInvalidHTML(url.host, code), {
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
        return new Response(renderUnauthorizedHTML(url.origin + "/"), {
            status: 404,
            headers: { "content-type": "text/html; charset=utf-8" }
        });
    },
} satisfies ExportedHandler<Env>;
