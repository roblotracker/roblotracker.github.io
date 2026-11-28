import { authorizationUrl, discordIdentity } from "./discord-oauth.mjs";

const origin = "https://roblotracker.github.io";
const browserRoutes = new Set(["/pair", "/view", "/lock", "/capabilities", "/oauth/start", "/oauth/finish"]);
const botRoutes = new Set(["/bot/approve", "/bot/jobs", "/bot/result"]);
const snowflake = /^[1-9][0-9]{16,18}$/;
const codePattern = /^[A-F0-9]{16}$/;
const tokenPattern = /^[a-f0-9]{64}$/;
const pairingLifetime = 5 * 60_000;
const sessionLifetime = 20 * 60_000;
const day = 86_400_000;
const discordSessionLifetime = 30 * day;
const maxDiscordSessions = 5000;
const refreshAge = 8_000;
const maximumAge = 18_000;
const trackerSections = new Set(["overview", "observations", "history"]);
const maxTrackerPage = 10_000;
const maxSessions = 300;
const sessionDirectory = "tracker-sessions-oauth";
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "600",
  Vary: "Origin",
};

function reply(value, status = 200) {
  return Response.json(value, { status, headers });
}

function randomHex(length) {
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function sessionDigest(token) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

function oauthReturn(value) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${origin}/dashboard/#oauth=${value}`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function approvedViewer(viewer) {
  if (!viewer || typeof viewer.name !== "string" || !viewer.name.trim()) return null;
  return {
    name: viewer.name.trim().slice(0, 80),
    username: typeof viewer.username === "string" ? viewer.username.slice(0, 40) : "",
    avatar: typeof viewer.avatar === "string" &&
      /^https:\/\/cdn\.discordapp\.com\/(?:avatars|embed\/avatars)\/[A-Za-z0-9_/.-]+(?:\?size=64)?$/.test(viewer.avatar)
      ? viewer.avatar : null,
  };
}

async function internalRequest(directory, path, value) {
  const response = await directory.fetch(new Request("https://dashboard.internal" + path, {
    method: "POST",
    body: JSON.stringify(value),
  }));
  if (!response.ok) throw new Error("OAuth session no longer valid");
  return response.json();
}

async function handleOAuthCallback(url, env, directory) {
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const issuer = url.searchParams.get("iss");
  if (!tokenPattern.test(state) || !code || code.length > 512 || !env.DISCORD_CLIENT_SECRET ||
      (issuer && issuer !== "https://discord.com")) return oauthReturn("failed");
  try {
    const { proof } = await internalRequest(directory, "/internal/oauth/consume", { state });
    const account = await discordIdentity(code, env.DISCORD_CLIENT_SECRET);
    const { handoff } = await internalRequest(directory, "/internal/oauth/store", { proof, account });
    return oauthReturn(handoff);
  } catch {
    return oauthReturn("failed");
  }
}

async function body(request) {
  if (!request.body) return {};
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return JSON.parse(text + decoder.decode() || "{}");
    bytes += value.byteLength;
    if (bytes > 48_000) {
      await reader.cancel();
      throw new Error("Request too large");
    }
    text += decoder.decode(value, { stream: true });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const directory = () => env.DASHBOARD.get(env.DASHBOARD.idFromName(sessionDirectory));
    if (path === "/oauth/callback") {
      if (request.method !== "GET") return reply({ error: "method_not_allowed" }, 405);
      return handleOAuthCallback(url, env, directory());
    }
    if (botRoutes.has(path)) {
      const expected = env.DASHBOARD_BOT_KEY;
      if (!expected || request.headers.get("Authorization") !== `Bearer ${expected}`) {
        return reply({ error: "unauthorized" }, 401);
      }
    } else if (browserRoutes.has(path)) {
      if (request.headers.get("Origin") !== origin) return new Response(null, { status: 403 });
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
      if (request.method === "POST" && path === "/capabilities") {
        return reply({ discordSignIn: Boolean(env.DISCORD_CLIENT_SECRET) });
      }
      if (request.method === "POST" && path === "/oauth/start" && !env.DISCORD_CLIENT_SECRET) {
        return reply({ error: "not_configured" }, 503);
      }
      if (request.method === "POST" && (path === "/pair" || path === "/oauth/start") && env.PAIR_LIMIT) {
        const limit = await env.PAIR_LIMIT.limit({ key: request.headers.get("CF-Connecting-IP") || "unknown" });
        if (!limit.success) return reply({ error: "try_again" }, 429);
      }
    } else {
      return reply({ error: "not_found" }, 404);
    }
    if (request.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
    return directory().fetch(request);
  },
};

export class DashboardSessions {
  constructor(state) {
    this.storage = state.storage;
    this.sql = this.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS discord_sessions (
      digest TEXT PRIMARY KEY, identity TEXT NOT NULL, expires INTEGER NOT NULL
    )`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS discord_sessions_expiry ON discord_sessions(expires)");
    this.sessions = new Map();
    this.discordSessions = new Map();
    this.codes = new Map();
    this.oauthAttempts = new Map();
    this.handoffs = new Map();
  }

  async alarm() {
    const now = Date.now();
    this.sql.exec("DELETE FROM discord_sessions WHERE expires <= ?", now);
    const [{ expires }] = this.sql.exec("SELECT MIN(expires) AS expires FROM discord_sessions").toArray();
    if (expires !== null) await this.storage.setAlarm(expires);
  }

  rememberDiscordSession(token, session) {
    this.discordSessions.delete(token);
    this.discordSessions.set(token, session);
    if (this.discordSessions.size > maxSessions) {
      this.discordSessions.delete(this.discordSessions.keys().next().value);
    }
  }

  async loadDiscordSession(token, now) {
    const cached = this.discordSessions.get(token);
    if (cached && cached.expires > now) return cached;
    const digest = await sessionDigest(token);
    const [stored] = this.sql.exec(
      "SELECT identity, expires FROM discord_sessions WHERE digest = ? AND expires > ?", digest, Date.now(),
    ).toArray();
    if (!stored) return null;
    const { id, guilds, ...viewer } = JSON.parse(stored.identity);
    const session = { member: id, guilds, viewer, digest, expires: stored.expires, views: new Map() };
    this.rememberDiscordSession(token, session);
    return session;
  }

  deleteSession(token, session) {
    this.sessions.delete(token);
    if (session.code) this.codes.delete(session.code);
  }

  clearExpired(now) {
    for (const [token, session] of this.sessions) {
      if (session.expires <= now) this.deleteSession(token, session);
    }
    for (const entries of [this.oauthAttempts, this.handoffs]) {
      for (const [key, item] of entries) if (item.expires <= now) entries.delete(key);
    }
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    const now = Date.now();
    this.clearExpired(now);
    let input;
    try {
      input = await body(request);
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error();
    } catch {
      return reply({ error: "invalid_body" }, 400);
    }
    if (path === "/oauth/start") {
      if (this.oauthAttempts.size >= maxSessions) return reply({ error: "busy" }, 429);
      const state = randomHex(32);
      const proof = randomHex(32);
      this.oauthAttempts.set(state, { proof, expires: now + pairingLifetime });
      return reply({ proof, url: authorizationUrl(state) });
    }
    if (path === "/internal/oauth/consume") {
      const attempt = this.oauthAttempts.get(input.state);
      if (!attempt || attempt.expires <= Date.now()) return reply({ error: "invalid_state" }, 403);
      this.oauthAttempts.delete(input.state);
      return reply({ proof: attempt.proof });
    }
    if (path === "/internal/oauth/store") {
      if (this.handoffs.size >= maxSessions) return reply({ error: "busy" }, 429);
      const handoff = randomHex(32);
      this.handoffs.set(handoff, { proof: input.proof, account: input.account, expires: now + 90_000 });
      return reply({ handoff });
    }
    if (path === "/oauth/finish") {
      const handoff = this.handoffs.get(input.handoff);
      if (!handoff || !tokenPattern.test(input.proof || "") || handoff.proof !== input.proof) {
        return reply({ error: "invalid_handoff" }, 403);
      }
      this.handoffs.delete(input.handoff);
      const token = randomHex(32);
      const digest = await sessionDigest(token);
      this.sql.exec("DELETE FROM discord_sessions WHERE expires <= ?", now);
      const [{ total }] = this.sql.exec("SELECT COUNT(*) AS total FROM discord_sessions").toArray();
      if (total >= maxDiscordSessions) return reply({ error: "busy" }, 429);
      const expires = now + discordSessionLifetime;
      this.sql.exec("INSERT INTO discord_sessions VALUES (?, ?, ?)", digest, JSON.stringify(handoff.account), expires);
      const { id, guilds, ...viewer } = handoff.account;
      this.rememberDiscordSession(token, { member: id, guilds, viewer, digest, expires, views: new Map() });
      const alarm = await this.storage.getAlarm();
      if (alarm === null || expires < alarm) await this.storage.setAlarm(expires);
      return reply({ token });
    }
    if (path === "/pair") {
      if (this.sessions.size >= maxSessions) return reply({ error: "busy" }, 429);
      if (input.channel && (typeof input.channel !== "string" || !snowflake.test(input.channel))) {
        return reply({ error: "invalid_channel" }, 400);
      }
      const token = randomHex(32);
      const code = randomHex(8).toUpperCase();
      this.sessions.set(token, { code, expires: now + pairingLifetime });
      this.codes.set(code, token);
      return reply({ token, code });
    }
    if (path === "/bot/approve") {
      if (![input.guild, input.member].every(id => typeof id === "string" && snowflake.test(id)) ||
          typeof input.code !== "string" || !codePattern.test(input.code)) {
        return reply({ error: "invalid_approval" }, 400);
      }
      const token = this.codes.get(input.code);
      const session = this.sessions.get(token);
      if (!session || session.expires <= Date.now()) return reply({ error: "invalid_code" }, 404);
      this.codes.delete(input.code);
      session.code = null;
      session.viewer = approvedViewer(input.viewer);
      session.guild = session.viewer ? null : input.guild;
      session.discover = Boolean(session.viewer);
      session.member = input.member;
      session.expires = now + sessionLifetime;
      session.views = new Map();
      return reply({ accepted: true });
    }
    if (path === "/bot/jobs") {
      const jobs = [];
      queue: for (const session of [...this.sessions.values(), ...this.discordSessions.values()]) {
        if (session.expires <= now) continue;
        if (!session.views) continue;
        for (const view of session.views.values()) {
          if (!view.wanted || now - view.wanted > 30_000 || view.leaseUntil > now) continue;
          view.job = randomHex(16);
          view.leaseUntil = now + 15_000;
          jobs.push({ job: view.job, guild: view.guild, member: session.member, channel: view.channel,
            section: view.section, page: view.page, signal: view.signal,
            guilds: session.guilds || null, discover: Boolean(session.discover) });
          if (jobs.length === 8) break queue;
        }
      }
      return reply({ jobs });
    }
    if (path === "/bot/result") {
      for (const session of [...this.sessions.values(), ...this.discordSessions.values()]) {
        if (session.expires <= now) continue;
        for (const view of session.views?.values() || []) {
          if (!view.job || view.job !== input.job) continue;
          view.job = null;
          view.leaseUntil = 0;
          view.wanted = 0;
          view.updated = now;
          view.data = input.data ?? null;
          return reply({ accepted: true });
        }
      }
      return reply({ error: "stale_job" }, 409);
    }
    const auth = request.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const session = tokenPattern.test(token) && (this.sessions.get(token) || await this.loadDiscordSession(token, now));
    if (!session || session.expires <= Date.now()) return reply({ error: "expired" }, 401);
    if (path === "/lock") {
      if (session.digest) {
        this.sql.exec("DELETE FROM discord_sessions WHERE digest = ?", session.digest);
        this.discordSessions.delete(token);
      } else {
        this.deleteSession(token, session);
      }
      return reply({ locked: true });
    }
    if (!session.member) return reply({ state: "pending", code: session.code });
    const channel = input.channel ?? null;
    if (channel !== null && (typeof channel !== "string" || !snowflake.test(channel))) {
      return reply({ error: "invalid_channel" }, 400);
    }
    let guild = session.guild || null;
    if ((session.guilds || session.discover) && input.guild != null) {
      if (typeof input.guild !== "string" || !snowflake.test(input.guild) ||
          (session.guilds && !session.guilds.includes(input.guild))) {
        return reply({ state: "denied", viewer: session.viewer });
      }
      guild = input.guild;
    }
    if (session.digest) {
      if (session.expires <= now + discordSessionLifetime - day) {
        session.expires = now + discordSessionLifetime;
        this.sql.exec("UPDATE discord_sessions SET expires = ? WHERE digest = ?", session.expires, session.digest);
      }
      this.rememberDiscordSession(token, session);
    }
    const section = channel ? input.section ?? "overview" : "overview";
    const page = channel ? input.page ?? 1 : 1;
    const signal = channel && section === "observations" ? input.signal ?? "" : "";
    if (!trackerSections.has(section) || !Number.isInteger(page) || page < 1 || page > maxTrackerPage ||
        typeof signal !== "string" || !/^[a-z_]{0,32}$/.test(signal)) {
      return reply({ error: "invalid_tracker_page" }, 400);
    }
    const viewKey = `${guild || ""}:${channel || ""}:${section}:${page}:${signal}`;
    const view = session.views.get(viewKey) || { guild, channel, section, page, signal };
    session.views.delete(viewKey);
    session.views.set(viewKey, view);
    if (session.views.size > 8) session.views.delete(session.views.keys().next().value);
    const age = now - (view.updated || 0);
    const serverDirectory = !guild && !channel;
    if (age >= (serverDirectory ? 45_000 : refreshAge)) view.wanted = now;
    if (age >= (serverDirectory ? 60_000 : maximumAge)) return reply({ state: "loading", viewer: session.viewer });
    return reply({ state: view.data ? "ready" : "denied", viewer: session.viewer, updated: view.updated, data: view.data });
  }
}
