const siteOrigin = "https://roblotracker.github.io";
const siteHost = "roblotracker.github.io";
const siteverify = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const installLink = "https://discord.com/oauth2/authorize?client_id=1561527919375814709&permissions=268823568&scope=bot%20applications.commands&integration_type=0";
const maxTokenBytes = 2048;

async function readToken(request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const bytes = new Uint8Array(maxTokenBytes);
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return new TextDecoder().decode(bytes.subarray(0, length)).trim();
    if (length + value.byteLength > maxTokenBytes) {
      await reader.cancel();
      return "";
    }
    bytes.set(value, length);
    length += value.byteLength;
  }
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== "/verify") return new Response(null, { status: 404 });
    if (request.headers.get("Origin") !== siteOrigin) return new Response(null, { status: 403 });
    const headers = { "Access-Control-Allow-Origin": siteOrigin, "Cache-Control": "no-store", Vary: "Origin" };
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } });
    if (!env.TURNSTILE_SECRET_KEY) return new Response(null, { status: 503, headers });

    try {
      const token = await readToken(request);
      if (!token) return new Response(null, { status: 400, headers });
      const response = await fetch(siteverify, {
        method: "POST",
        body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token }),
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
      if (!response.ok) return new Response(null, { status: 503, headers });
      const result = await response.json();
      if (result.success !== true || result.hostname !== siteHost || result.action !== "rt_install") {
        return new Response(null, { status: 403, headers });
      }
      return Response.json({ redirect: installLink }, { headers });
    } catch {
      return new Response(null, { status: 503, headers });
    }
  },
};
