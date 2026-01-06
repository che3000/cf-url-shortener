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
    API_TOKEN?: string;
}

type KVValue = {
    url: string;
    created: number; // epoch seconds
    ttl?: number; // seconds (undefined = 永久)
    valid?: boolean; // soft delete: false = 註銷
    interstitial_enabled: boolean;
    interstitial_seconds?: number; // seconds (0 = disable)
};

type KVListResult = {
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
};

type LinkStatus = "active" | "expiring" | "expired" | "invalid" | "missing";

type ListedItem = {
    code: string;
    url?: string;
    created?: number;
    ttl?: number | null;
    expiresAt?: number | null;
    status?: LinkStatus;
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
    } catch {
        return null;
    }
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

// ===== Auth (Token + Cloudflare Access injected headers) =====

const verifyToken = (req: Request, env: Env): boolean => {
    // C2: 未設定 API_TOKEN，不允許走 token 路徑（避免誤開放）
    if (!env.API_TOKEN) return false;
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    return token === env.API_TOKEN;
};

const requireAuth = (req: Request, env: Env): boolean => verifyToken(req, env);

// ===== CORS (same-origin) =====

const buildCors = (req: Request, origin: string) => {
    const o = req.headers.get("origin") || "";
    const allow = o && o === origin ? o : "";
    return {
        "access-control-allow-origin": allow,
        vary: "origin",
        "access-control-allow-headers": "authorization,content-type",
        "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
        "access-control-max-age": "86400",
    };
};

// ===== helpers (M1) =====

const toBool = (v: unknown) => v === true || String(v).toLowerCase() === "true";

const toIntOrNull = (v: unknown) => {
    if (v === null || v === "" || typeof v === "undefined") return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.floor(n);
};

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

        // OPTIONS (L3 already fixed: no DELETE)
        if (req.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: buildCors(req, url.origin) });
        }

        // favicon
        if (req.method === "GET" && (url.pathname === "/favicon.ico" || url.pathname === "/favicon.svg")) {
            return new Response(FAVICON_SVG, {
                headers: {
                    "content-type": "image/svg+xml; charset=utf-8",
                    "cache-control": "public, max-age=86400",
                },
            });
        }

        // styles
        if (req.method === "GET" && url.pathname === "/styles.css") {
            return new Response(STYLES_CSS, {
                headers: {
                    "content-type": "text/css; charset=utf-8",
                    "cache-control": "no-cache, no-store, must-revalidate",
                },
            });
        }

        // admin page (你已用 Zero Trust 保護 /admin*，此處不額外做 cookie/JWT 解析)
        if (req.method === "GET" && path === "admin") {
            return new Response(renderAdminHTML(), { headers: { "content-type": "text/html; charset=utf-8" } });
        }

        // root page
        if (req.method === "GET" && path === "") {
            const author = env.AUTHOR ?? "";
            const contact = env.CONTACT ?? "";
            return new Response(renderRootHTML(author, contact), {
                headers: { "content-type": "text/html; charset=utf-8" },
            });
        }

        // ===== API: POST /api/links =====
        if (req.method === "POST" && path === "api/links") {
            if (!requireAuth(req, env)) return json({ error: "unauthorized" }, 401);

            const body = (await getBody(req)) as {
                url?: string;
                code?: string;
                ttl_hours?: number | string;
                ttl?: number | string;
                interstitial_enabled?: boolean | string;
                interstitial_seconds?: number | string | null;
            };

            const longUrl = normalizeUrl(body.url);
            if (!longUrl) return json({ error: "invalid url" }, 400);

            let code = body.code?.trim();

            if (code) {
                if (!/^[\w-]{3,64}$/.test(code)) return json({ error: "invalid code format" }, 400);
                const existing = await env.LINKS.get(code);
                if (existing) return json({ error: "code already in use" }, 409);
            } else {
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

            // TTL
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

            // M1: interstitial parsing (consistent)
            const enabled = toBool(body.interstitial_enabled);
            let interstitialSeconds = 0;
            if (enabled) {
                const s = toIntOrNull(body.interstitial_seconds);
                interstitialSeconds = s && s > 0 ? s : 5;
            }

            const payload: KVValue = {
                url: longUrl,
                created: nowSec(),
                ttl: ttlSec,
                valid: true,
                interstitial_enabled: enabled,
                interstitial_seconds: interstitialSeconds,
            };

            await env.LINKS.put(code!, JSON.stringify(payload));
            const meta = computeMeta(payload);

            return json({
                code,
                short: `${url.origin}/${code}`,
                url: longUrl,
                ttl: payload.ttl ?? null,
                created: payload.created,
                expiresAt: meta.expiresAt,
                status: meta.status,
                remaining: meta.remaining,
                interstitial_enabled: payload.interstitial_enabled,
                interstitial_seconds: payload.interstitial_seconds ?? null,
            });
        }

        // ===== API: GET /api/links/:code =====
        if (req.method === "GET" && path.startsWith("api/links/")) {
            if (!requireAuth(req, env)) return json({ error: "unauthorized" }, 401);

            const code = path.split("/").pop() || "";
            if (!code) return json({ error: "invalid code" }, 400);

            const raw = await env.LINKS.get(code, { type: "text" });
            if (!raw) return json({ error: "not found" }, 404);

            let v: KVValue | null = null;
            try {
                v = JSON.parse(raw) as KVValue;
            } catch {
                v = null;
            }
            if (!v?.url) return json({ error: "not found" }, 404);

            const meta = computeMeta(v);
            return json({
                code,
                url: v.url,
                ttl: v.ttl ?? null,
                created: v.created,
                expiresAt: meta.expiresAt,
                status: meta.status,
                remaining: meta.remaining,
                valid: v.valid !== false,
                interstitial_enabled: v.interstitial_enabled,
                interstitial_seconds: v.interstitial_seconds ?? null,
            });
        }

        // ===== API: GET /api/links?limit=&cursor=&expand=1 =====
        if (req.method === "GET" && path === "api/links") {
            if (!requireAuth(req, env)) return json({ error: "unauthorized" }, 401);

            const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit") || "100")));
            const cursor = url.searchParams.get("cursor") || undefined;
            const expand = url.searchParams.get("expand") === "1";

            // L2: 防止 expand 造成大量 KV.get（你不想大改的情況下，先用硬上限）
            if (expand && limit > 200) {
                return json({ error: "expand too large; reduce limit to <= 200" }, 400);
            }

            const list = (await env.LINKS.list({ limit, cursor })) as KVListResult;
            let items: ListedItem[] = list.keys.map((k) => ({ code: k.name }));

            if (expand && items.length) {
                items = await Promise.all(
                    items.map(async (it) => {
                        const raw = await env.LINKS.get(it.code, { type: "text" });

                        // L1: missing vs expired
                        if (!raw) return { code: it.code, status: "missing" as const };

                        let v: KVValue | null = null;
                        try {
                            v = JSON.parse(raw) as KVValue;
                        } catch {
                            v = null;
                        }

                        if (!v?.url) return { code: it.code, status: "missing" as const };

                        const meta = computeMeta(v);
                        return {
                            code: it.code,
                            url: v.url,
                            created: v.created,
                            ttl: v.ttl ?? null,
                            expiresAt: meta.expiresAt,
                            status: meta.status,
                            remaining: meta.remaining,
                            interstitial_enabled: v.interstitial_enabled ?? false,
                            interstitial_seconds: v.interstitial_seconds ?? null,
                        };
                    })
                );
            }

            return json({ items, cursor: list.cursor || null, list_complete: list.list_complete });
        }

        // ===== API: PATCH /api/links/:code =====
        if (req.method === "PATCH" && path.startsWith("api/links/")) {
            if (!requireAuth(req, env)) return json({ error: "unauthorized" }, 401);

            const code = path.split("/").pop() || "";
            if (!code) return json({ error: "invalid code" }, 400);

            const raw = await env.LINKS.get(code, { type: "text" });
            if (!raw) return json({ error: "not found" }, 404);

            let v: KVValue | null = null;
            try {
                v = JSON.parse(raw) as KVValue;
            } catch {
                v = null;
            }
            if (!v?.url) return json({ error: "not found" }, 404);

            const body = (await getBody(req)) as {
                action?: "invalidate" | "restore";
                interstitial_enabled?: boolean | string;
                interstitial_seconds?: number | string | null;
                ttl_hours?: number | string | null;
            };

            // 1) invalidate/restore
            if (body.action === "invalidate") v.valid = false;
            else if (body.action === "restore") v.valid = true;
            else if (body.action != null) return json({ error: "invalid action" }, 400);

            // 2) interstitial (M1 consistent parsing)
            const hasToggle = typeof body.interstitial_enabled !== "undefined" && body.interstitial_enabled !== "";
            const hasSeconds = typeof body.interstitial_seconds !== "undefined";

            if (hasToggle || hasSeconds) {
                const enabled = hasToggle ? toBool(body.interstitial_enabled) : (v.interstitial_enabled ?? false);
                v.interstitial_enabled = enabled;

                if (!enabled) {
                    // 關閉時 seconds 一律設 0
                    v.interstitial_seconds = 0;
                } else if (hasSeconds) {
                    const s = toIntOrNull(body.interstitial_seconds);
                    if (s === null) {
                        v.interstitial_seconds = 0;
                    } else if (s < 0) {
                        return json({ error: "invalid interstitial_seconds" }, 400);
                    } else {
                        v.interstitial_seconds = s;
                    }
                } else {
                    // enabled=true 但沒傳 seconds：若原本是 0/undefined，給預設 5
                    if (!v.interstitial_seconds || v.interstitial_seconds <= 0) v.interstitial_seconds = 5;
                }
            }

            // 3) TTL (你說不改：維持「更新 TTL 會重設 created」的行為)
            if (typeof body.ttl_hours !== "undefined") {
                if (body.ttl_hours === null || body.ttl_hours === "") {
                    v.ttl = undefined;
                } else {
                    const hours = Number(body.ttl_hours);
                    if (!Number.isFinite(hours) || hours <= 0) return json({ error: "invalid ttl_hours" }, 400);
                    v.ttl = Math.round(hours * 3600);
                    v.created = nowSec();
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
                interstitial_seconds: v.interstitial_seconds ?? null,
                ttl: v.ttl ?? null,
                expiresAt: meta.expiresAt,
                remaining: meta.remaining,
            });
        }

        // ===== Redirect: GET /:code =====
        if (req.method === "GET" && path && !path.includes("/")) {
            const code = path;
            const raw = await env.LINKS.get(code, { type: "text" });
            if (!raw) {
                return new Response(renderInvalidHTML(url.host, code), {
                    status: 404,
                    headers: { "content-type": "text/html; charset=utf-8" },
                });
            }

            let v: KVValue | null = null;
            try {
                v = JSON.parse(raw) as KVValue;
            } catch {
                v = null;
            }
            if (!v?.url) {
                return new Response(renderInvalidHTML(url.host, code), {
                    status: 404,
                    headers: { "content-type": "text/html; charset=utf-8" },
                });
            }

            const meta = computeMeta(v);
            if (meta.status === "expired" || v.valid === false) {
                return new Response(renderInvalidHTML(url.host, code), {
                    status: 410,
                    headers: { "content-type": "text/html; charset=utf-8" },
                });
            }

            if (v.interstitial_enabled && v.interstitial_seconds && v.interstitial_seconds > 0) {
                const interstitialHTML = renderInterstitialHTML(v.url, { seconds: v.interstitial_seconds });
                return new Response(interstitialHTML, { headers: { "content-type": "text/html; charset=utf-8" } });
            }

            return Response.redirect(v.url, 302);
        }

        // 404
        return new Response(renderUnauthorizedHTML(url.origin + "/"), {
            status: 404,
            headers: { "content-type": "text/html; charset=utf-8" },
        });
    },
} satisfies ExportedHandler<Env>;
