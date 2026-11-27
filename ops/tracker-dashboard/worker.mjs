const origin = "https://roblotracker.github.io";
const browserRoutes = new Set(["/pair", "/view", "/lock"]);
const botRoutes = new Set(["/bot/approve", "/bot/jobs", "/bot/result"]);
const snowflake = /^[1-9][0-9]{16,18}$/;
const codePattern = /^[A-F0-9]{16}$/;
const tokenPattern = /^[a-f0-9]{64}$/;
const pairingLifetime = 5 * 60_000;
const sessionLifetime = 20 * 60_000;
const refreshAge = 12_000;
const maximumAge = 24_000;
const maxSessions = 300;
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
    const path = new URL(request.url).pathname;
    if (botRoutes.has(path)) {
      const expected = env.DASHBOARD_BOT_KEY;
      if (!expected || request.headers.get("Authorization") !== `Bearer ${expected}`) {
        return reply({ error: "unauthorized" }, 401);
      }
    } else if (browserRoutes.has(path)) {
      if (request.headers.get("Origin") !== origin) return new Response(null, { status: 403 });
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
      if (request.method === "POST" && path === "/pair" && env.PAIR_LIMIT) {
        const limit = await env.PAIR_LIMIT.limit({ key: request.headers.get("CF-Connecting-IP") || "unknown" });
        if (!limit.success) return reply({ error: "try_again" }, 429);
      }
    } else {
      return reply({ error: "not_found" }, 404);
    }
    if (request.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
    return env.DASHBOARD.get(env.DASHBOARD.idFromName("tracker-sessions")).fetch(request);
  },
};

export class DashboardSessions {
  constructor() {
    this.sessions = new Map();
    this.codes = new Map();
  }

  deleteSession(token, session) {
    this.sessions.delete(token);
    if (session.code) this.codes.delete(session.code);
  }

  clearExpired(now) {
    for (const [token, session] of this.sessions) {
      if (session.expires <= now) this.deleteSession(token, session);
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
      session.guild = input.guild;
      session.member = input.member;
      session.expires = now + sessionLifetime;
      session.views = new Map();
      return reply({ accepted: true });
    }
    if (path === "/bot/jobs") {
      const jobs = [];
      queue: for (const session of this.sessions.values()) {
        if (!session.views) continue;
        for (const [channel, view] of session.views) {
          if (!view.wanted || now - view.wanted > 30_000 || view.leaseUntil > now) continue;
          view.job = randomHex(16);
          view.leaseUntil = now + 15_000;
          jobs.push({ job: view.job, guild: session.guild, member: session.member, channel });
          if (jobs.length === 8) break queue;
        }
      }
      return reply({ jobs });
    }
    if (path === "/bot/result") {
      for (const session of this.sessions.values()) {
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
    const session = tokenPattern.test(token) && this.sessions.get(token);
    if (!session || session.expires <= Date.now()) return reply({ error: "expired" }, 401);
    if (path === "/lock") {
      this.deleteSession(token, session);
      return reply({ locked: true });
    }
    if (!session.member) return reply({ state: "pending", code: session.code });
    const channel = input.channel ?? null;
    if (channel !== null && (typeof channel !== "string" || !snowflake.test(channel))) {
      return reply({ error: "invalid_channel" }, 400);
    }
    const view = session.views.get(channel) || {};
    session.views.delete(channel);
    session.views.set(channel, view);
    if (session.views.size > 8) session.views.delete(session.views.keys().next().value);
    const age = now - (view.updated || 0);
    if (age >= refreshAge) view.wanted = now;
    if (age >= maximumAge) return reply({ state: "loading" });
    return reply({ state: view.data ? "ready" : "denied", updated: view.updated, data: view.data });
  }
}
