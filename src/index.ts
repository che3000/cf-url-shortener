// Cloudflare Workers - URL Shortener
// Access-enforced version: Admin/API require Cloudflare Access session or Service Token.
// No API_TOKEN in frontend, no custom API secret in worker.

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
    created: number; // epoch seconds
    ttl?: number;    // seconds (undefined = permanent)
    valid?: boolean; // soft delete
    interstitial_enabled: boolean;
    interstitial_seconds?: number; // 0 = disabled
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

// ---------- helpers ----------

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json; charset=utf-8", ...headers },
    });

const nowSec = () => Math.floor(Date.now() / 1000);

const normalizeUrl = (raw?: string | null): string | null => {
    if (!raw) return null;
    let s = String(raw).trim();
    if (!s) return null;
    if (!/^[a-zA-Z][\w+.-]*:/.test(s)) s = `https://${s}`;
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
    if (ct.includes("application/json")) return await req.json().catch(() => ({}));
    if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
        const form = await req.formData();
        const obj: Record<string, unknown> = {};
        for (const [k, v] of form.entries()) obj[k] = typeof v === "string" ? v : v.name;
        return obj;
    }
    return {};
};

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

// CORS (same-origin; admin uses same origin fetch)
const buildCors = (req: Request, origin: string) => {
    const o = req.headers.get("origin") || "";
    const allow = o && o === origin ? o : "";
    return {
        "access-control-allow-origin": allow,
        vary: "origin",
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
        "access-control-max-age": "86400",
    };
};

export default {
    async fetch(req: Request, env: Env): Promise<Response> {
        const url = new URL(req.url);
        const path = url.pathname.replace(/^\/+/, "");

        // Preflight
        if (req.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: buildCors(req, url.origin) });
        }

        // favicon
        if (req.method === "GET" && (path === "favicon.ico" || path === "favicon.svg")) {
            return new Response(FAVICON_SVG, {
                headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=86400" },
            });
        }

        // styles
        if (req.method === "GET" && path === "styles.css") {
            return new Response(STYLES_CSS, {
                headers: { "content-type": "text/css; charset=utf-8", "cache-control": "no-cache, no-store" },
            });
        }

        // root
        if (req.method === "GET" && path === "") {
            return new Response(renderRootHTML(env.AUTHOR ?? "", env.CONTACT ?? ""), {
                headers: { "content-type": "text/html; charset=utf-8" },
            });
        }

        // admin (must be Access-approved)
        if (req.method === "GET" && (path === "admin" || path.startsWith("admin/"))) {
            return new Response(renderAdminHTML(), { headers: { "content-type": "text/html; charset=utf-8" } });
        }

        // POST /api/links
        if (req.method === "POST" && path === "api/links") {
            const body = (await getBody(req)) as any;
            const longUrl = normalizeUrl(body.url);
            if (!longUrl) return json({ error: "invalid url" }, 400, buildCors(req, url.origin));

            let code = body.code?.trim();
            if (code) {
                if (!/^[\w-]{3,64}$/.test(code)) return json({ error: "invalid code format" }, 400, buildCors(req, url.origin));
                if (await env.LINKS.get(code)) return json({ error: "code already in use" }, 409, buildCors(req, url.origin));
            } else {
                let ok = false;
                for (let i = 0; i < 10; i++) {
                    const c = genCode(6);
                    if (!(await env.LINKS.get(c))) {
                        code = c;
                        ok = true;
                        break;
                    }
                }
                if (!ok) return json({ error: "failed to generate code" }, 500, buildCors(req, url.origin));
            }

            let ttlSec: number | undefined;
            if (body.ttl_hours !== undefined && String(body.ttl_hours) !== "") {
                const h = Number(body.ttl_hours);
                if (!Number.isFinite(h) || h <= 0) return json({ error: "invalid ttl_hours" }, 400, buildCors(req, url.origin));
                ttlSec = Math.round(h * 3600);
            } else if (body.ttl !== undefined && String(body.ttl) !== "") {
                const t = Number(body.ttl);
                if (!Number.isFinite(t) || t <= 0) return json({ error: "invalid ttl" }, 400, buildCors(req, url.origin));
                ttlSec = Math.round(t);
            }

            const enabled = toBool(body.interstitial_enabled);
            const s = toIntOrNull(body.interstitial_seconds);

            const payload: KVValue = {
                url: longUrl,
                created: nowSec(),
                ttl: ttlSec,
                valid: true,
                interstitial_enabled: enabled,
                interstitial_seconds: enabled ? (s && s > 0 ? s : 5) : 0,
            };

            await env.LINKS.put(code!, JSON.stringify(payload));
            const meta = computeMeta(payload);

            return json(
                {
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
                },
                200,
                buildCors(req, url.origin)
            );
        }

        // GET /api/links
        if (req.method === "GET" && path === "api/links") {
            const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || "100")));
            const cursor = url.searchParams.get("cursor") || undefined;
            const expand = url.searchParams.get("expand") === "1";

            const list = (await env.LINKS.list({ limit, cursor })) as KVListResult;
            let items: ListedItem[] = list.keys.map((k) => ({ code: k.name }));

            if (expand) {
                items = await Promise.all(
                    items.map(async (it) => {
                        const raw = await env.LINKS.get(it.code, { type: "text" });
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
                            interstitial_enabled: v.interstitial_enabled,
                            interstitial_seconds: v.interstitial_seconds ?? null,
                        };
                    })
                );
            }

            return json({ items, cursor: list.cursor || null, list_complete: list.list_complete }, 200, buildCors(req, url.origin));
        }

        // PATCH /api/links/:code
        if (req.method === "PATCH" && path.startsWith("api/links/")) {
            const code = path.split("/").pop()!;
            const raw = await env.LINKS.get(code, { type: "text" });
            if (!raw) return json({ error: "not found" }, 404, buildCors(req, url.origin));

            let v: KVValue | null = null;
            try {
                v = JSON.parse(raw) as KVValue;
            } catch {
                v = null;
            }
            if (!v?.url) return json({ error: "not found" }, 404, buildCors(req, url.origin));

            const body = (await getBody(req)) as any;

            if (body.action === "invalidate") v.valid = false;
            else if (body.action === "restore") v.valid = true;
            else if (body.action != null) return json({ error: "invalid action" }, 400, buildCors(req, url.origin));

            if (body.ttl_hours !== undefined) {
                if (body.ttl_hours === null || body.ttl_hours === "") v.ttl = undefined;
                else {
                    const h = Number(body.ttl_hours);
                    if (!Number.isFinite(h) || h <= 0) return json({ error: "invalid ttl_hours" }, 400, buildCors(req, url.origin));
                    v.ttl = Math.round(h * 3600);
                    v.created = nowSec();
                }
            }

            if (body.interstitial_enabled !== undefined || body.interstitial_seconds !== undefined) {
                const en = body.interstitial_enabled !== undefined ? toBool(body.interstitial_enabled) : v.interstitial_enabled;
                v.interstitial_enabled = en;

                if (!en) v.interstitial_seconds = 0;
                else {
                    const s = toIntOrNull(body.interstitial_seconds);
                    v.interstitial_seconds = s && s > 0 ? s : 5;
                }
            }

            await env.LINKS.put(code, JSON.stringify(v));
            const meta = computeMeta(v);

            return json(
                { ok: true, code, status: meta.status, expiresAt: meta.expiresAt, remaining: meta.remaining },
                200,
                buildCors(req, url.origin)
            );
        }

        // ---------- redirect ----------
        if (req.method === "GET" && path && !path.includes("/")) {
            const raw = await env.LINKS.get(path, { type: "text" });
            if (!raw) {
                return new Response(renderInvalidHTML(url.host, path), {
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
                return new Response(renderInvalidHTML(url.host, path), {
                    status: 404,
                    headers: { "content-type": "text/html; charset=utf-8" },
                });
            }

            const meta = computeMeta(v);
            if (meta.status === "expired" || v.valid === false) {
                return new Response(renderInvalidHTML(url.host, path), {
                    status: 410,
                    headers: { "content-type": "text/html; charset=utf-8" },
                });
            }

            if (v.interstitial_enabled && v.interstitial_seconds && v.interstitial_seconds > 0) {
                return new Response(renderInterstitialHTML(v.url, { seconds: v.interstitial_seconds }), {
                    headers: { "content-type": "text/html; charset=utf-8" },
                });
            }

            return Response.redirect(v.url, 302);
        }

        return new Response(renderUnauthorizedHTML(url.origin + "/"), {
            status: 404,
            headers: { "content-type": "text/html; charset=utf-8" },
        });
    },
} satisfies ExportedHandler<Env>;
