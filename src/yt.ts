/**
 * Shared YouTube Data API v3 client for the youtube-manager plugin.
 *
 * Auth, in order of preference:
 *   1. Managed OAuth via `assistant oauth request --provider google` — zero-setup
 *      when the user's Google connection includes the youtube.readonly scope.
 *      Connect with:
 *        assistant oauth connect google --scopes <defaults> \
 *          https://www.googleapis.com/auth/youtube.readonly
 *   2. YOUTUBE_API_KEY env var
 *   3. Encrypted credential vault: `assistant credentials` under
 *      service=youtube field=api_key. Never stored in the workspace —
 *      workspace files end up in backups/sync. A legacy
 *      plugins-data/youtube-manager/credentials.json, if found, is migrated
 *      into the vault once and deleted.
 *
 * All tools here are public reads (search, stats, comments). Write operations
 * (updating video metadata, replying to comments) would additionally need the
 * full youtube scope and are out of scope for this version.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import type { ToolContext } from "@vellumai/plugin-api";

export const PLUGIN_NAME = "youtube-manager";
const API_BASE = "https://www.googleapis.com/youtube/v3";

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export function storageDir(workingDir: string | undefined): string {
  const base = workingDir ?? process.env.VELLUM_WORKSPACE_DIR ?? "/workspace";
  return path.join(base, "plugins-data", PLUGIN_NAME);
}

export async function readJson<T>(
  workingDir: string | undefined,
  file: string,
  fallback: T,
): Promise<T> {
  try {
    const raw = await fs.readFile(path.join(storageDir(workingDir), file), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(
  workingDir: string | undefined,
  file: string,
  data: unknown,
): Promise<void> {
  const dir = storageDir(workingDir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, file), JSON.stringify(data, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// API key resolution
// ---------------------------------------------------------------------------

const OAUTH_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

const NO_AUTH_MSG =
  "YouTube access is not set up. Two options:\n" +
  "1. (Recommended) Managed OAuth — reconnect Google with the YouTube scope added:\n" +
  "   assistant oauth connect google --scopes <your current scopes> " +
  `${OAUTH_SCOPE}\n` +
  "2. API key — create one at https://console.cloud.google.com (enable 'YouTube " +
  "Data API v3'), then store it in the encrypted vault:\n" +
  "   assistant credentials prompt --service youtube --field api_key\n" +
  "   (or set the YOUTUBE_API_KEY env var).";

const CRED_SERVICE = "youtube";
const CRED_FIELD = "api_key";

function credentialsCli(args: string[], ctx: ToolContext): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "assistant",
      ["credentials", ...args],
      { timeout: 15_000, maxBuffer: 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve((stdout ?? "").trim())),
    );
    ctx.signal?.addEventListener("abort", () => child.kill(), { once: true });
  });
}

/**
 * One-time migration: older versions stored the API key in a workspace file
 * (plugins-data/youtube-manager/credentials.json). Workspace files leak into
 * backups/sync, so if that file exists, move the key into the encrypted
 * credential vault and delete the file.
 */
async function migrateLegacyKeyFile(ctx: ToolContext): Promise<void> {
  const legacyPath = path.join(storageDir(ctx.workingDir), "credentials.json");
  let raw: string;
  try {
    raw = await fs.readFile(legacyPath, "utf8");
  } catch {
    return; // no legacy file — nothing to do
  }
  try {
    const key = (JSON.parse(raw) as { apiKey?: string }).apiKey?.trim();
    if (key) {
      await credentialsCli(
        ["set", "--service", CRED_SERVICE, "--field", CRED_FIELD, key],
        ctx,
      );
    }
    await fs.unlink(legacyPath);
  } catch {
    // Vault write failed — leave the file so the user's key isn't lost;
    // resolveApiKey will surface NO_AUTH_MSG with vault instructions.
  }
}

async function resolveApiKey(ctx: ToolContext): Promise<string | null> {
  const envKey = process.env.YOUTUBE_API_KEY?.trim();
  if (envKey) return envKey;
  await migrateLegacyKeyFile(ctx);
  try {
    const key = await credentialsCli(
      ["reveal", "--service", CRED_SERVICE, "--field", CRED_FIELD],
      ctx,
    );
    return key || null;
  } catch {
    return null; // not stored (or CLI unavailable)
  }
}

// ---------------------------------------------------------------------------
// Managed OAuth transport (assistant CLI)
// ---------------------------------------------------------------------------

/**
 * Session cache: null = untested, false = OAuth unavailable (missing scope /
 * not connected), true = OAuth works. Avoids paying a failed-CLI round trip
 * on every call once we know the answer.
 */
let oauthUsable: boolean | null = null;

function oauthRequest(url: string, ctx: ToolContext): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "assistant",
      ["oauth", "request", "--provider", "google", "-s", url],
      { timeout: 45_000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        // The CLI exits non-zero on HTTP errors but still prints the body.
        const raw = (stdout ?? "").trim();
        const jsonStart = raw.indexOf("{");
        if (jsonStart === -1) {
          reject(new Error(err ? `oauth request failed: ${err.message}` : "empty response"));
          return;
        }
        try {
          resolve(JSON.parse(raw.slice(jsonStart)));
        } catch {
          reject(new Error("oauth request returned non-JSON response"));
        }
      },
    );
    ctx.signal?.addEventListener("abort", () => child.kill(), { once: true });
  });
}

function isScopeOrAuthError(body: any): boolean {
  const reason =
    body?.error?.details?.[0]?.reason ?? body?.error?.errors?.[0]?.reason ?? "";
  const status = body?.error?.status ?? "";
  return (
    reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT" ||
    reason === "authError" ||
    status === "PERMISSION_DENIED" ||
    status === "UNAUTHENTICATED"
  );
}

// ---------------------------------------------------------------------------
// Fetch wrapper
// ---------------------------------------------------------------------------

function throwApiError(body: any, httpStatus?: number): never {
  const reason = body?.error?.errors?.[0]?.reason ?? "";
  const message = body?.error?.message ?? `HTTP ${httpStatus ?? "?"}`;
  if (reason === "quotaExceeded") {
    throw new Error(
      "YouTube API daily quota exceeded (resets midnight Pacific). " +
        "Search costs 100 units/call; detail lookups cost 1. Prefer youtube_video / " +
        "youtube_channel over youtube_search when you already have IDs.",
    );
  }
  throw new Error(
    `YouTube API error${reason ? ` (${reason})` : ""}: ${message}`,
  );
}

export async function ytFetch(
  endpoint: string,
  params: Record<string, string | number | undefined>,
  ctx: ToolContext,
): Promise<any> {
  const url = new URL(`${API_BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  // 1. Managed OAuth through the assistant CLI (zero-setup path).
  if (oauthUsable !== false) {
    try {
      const body = await oauthRequest(url.toString(), ctx);
      if (!body?.error) {
        oauthUsable = true;
        return body;
      }
      if (isScopeOrAuthError(body)) {
        oauthUsable = false; // fall through to API key
      } else {
        oauthUsable = true; // real API error on a working token (quota, bad param)
        throwApiError(body);
      }
    } catch (err: any) {
      // CLI missing, not connected, or transport failure — try the key path.
      if (err?.message?.startsWith("YouTube API")) throw err;
      oauthUsable = false;
    }
  }

  // 2. API key fallback.
  const key = await resolveApiKey(ctx);
  if (!key) throw new Error(NO_AUTH_MSG);
  url.searchParams.set("key", key);

  const res = await fetch(url.toString(), { signal: ctx.signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.error?.message ?? res.statusText;
    if (res.status === 400 && /API key/i.test(message)) {
      throw new Error(`YouTube API rejected the key: ${message}\n${NO_AUTH_MSG}`);
    }
    throwApiError(body, res.status);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

/** Accepts a bare video ID or any common YouTube URL form. */
export function parseVideoId(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (/(^|\.)youtube\.com$/.test(u.hostname)) {
      if (u.searchParams.get("v")) return u.searchParams.get("v");
      const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[2];
    }
  } catch {
    /* not a URL */
  }
  return null;
}

export interface ChannelRef {
  id?: string; // UC...
  handle?: string; // @name
}

/** Accepts a channel ID (UC...), @handle, or channel URL. */
export function parseChannelRef(input: string): ChannelRef | null {
  const s = input.trim();
  if (/^UC[A-Za-z0-9_-]{22}$/.test(s)) return { id: s };
  if (s.startsWith("@")) return { handle: s };
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    if (/(^|\.)youtube\.com$/.test(u.hostname)) {
      const chan = u.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})/);
      if (chan) return { id: chan[1] };
      const handle = u.pathname.match(/^\/(@[A-Za-z0-9._-]+)/);
      if (handle) return { handle: handle[1] };
    }
  } catch {
    /* not a URL */
  }
  // Last resort: treat a plain word as a handle.
  if (/^[A-Za-z0-9._-]+$/.test(s)) return { handle: `@${s}` };
  return null;
}

/** Resolve any channel reference to a full channel resource. */
export async function fetchChannel(ref: ChannelRef, ctx: ToolContext): Promise<any | null> {
  const params: Record<string, string> = {
    part: "snippet,statistics,contentDetails",
  };
  if (ref.id) params.id = ref.id;
  else if (ref.handle) params.forHandle = ref.handle;
  else return null;
  const data = await ytFetch("channels", params, ctx);
  return data.items?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function fmtCount(n: string | number | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "0";
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

/** ISO8601 duration (PT1H2M3S) -> "1:02:03" */
export function fmtDuration(iso: string | undefined): string {
  if (!iso) return "?";
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return iso;
  const [h, min, s] = [Number(m[1] ?? 0), Number(m[2] ?? 0), Number(m[3] ?? 0)];
  const mm = h > 0 ? String(min).padStart(2, "0") : String(min);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function fmtDate(iso: string | undefined): string {
  if (!iso) return "?";
  return iso.slice(0, 10);
}

export function videoUrl(id: string): string {
  return `https://youtu.be/${id}`;
}

/** One-line summary for a video resource with statistics. */
export function fmtVideoLine(v: any): string {
  const s = v.statistics ?? {};
  const views = fmtCount(s.viewCount);
  const likes = fmtCount(s.likeCount);
  const comments = fmtCount(s.commentCount);
  const dur = fmtDuration(v.contentDetails?.duration);
  return (
    `${v.snippet?.title} — ${views} views, ${likes} likes, ${comments} comments, ` +
    `${dur} (${fmtDate(v.snippet?.publishedAt)}) ${videoUrl(v.id)}`
  );
}

// ---------------------------------------------------------------------------
// Watchlist state
// ---------------------------------------------------------------------------

export interface WatchlistEntry {
  channelId: string;
  title: string;
  handle?: string;
  uploadsPlaylistId: string;
  subscriberCount?: string;
  addedAt: string;
  lastCheckedAt?: string;
}

export interface WatchlistState {
  channels: WatchlistEntry[];
}

export async function loadWatchlist(workingDir: string | undefined): Promise<WatchlistState> {
  return readJson<WatchlistState>(workingDir, "watchlist.json", { channels: [] });
}

export async function saveWatchlist(
  workingDir: string | undefined,
  state: WatchlistState,
): Promise<void> {
  await writeJson(workingDir, "watchlist.json", state);
}
