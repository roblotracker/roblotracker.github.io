const discordAPI = "https://discord.com/api/v10";
const clientId = "1561527919375814709";
export const oauthCallback = "https://roblotracker-tracker-dashboard.install-verifier.workers.dev/oauth/callback";
const snowflake = /^[1-9][0-9]{16,18}$/;

export function authorizationUrl(state) {
  const url = new URL("https://discord.com/oauth2/authorize");
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: "identify guilds",
    redirect_uri: oauthCallback,
    state,
  }).toString();
  return url.href;
}

async function discordJson(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, redirect: "manual" });
    if (!response.ok) throw new Error("Discord OAuth request failed");
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function discordIdentity(code, secret) {
  const token = await discordJson(discordAPI + "/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: secret,
      code,
      redirect_uri: oauthCallback,
    }).toString(),
  });
  if (typeof token.access_token !== "string") throw new Error("Discord did not issue an access token");
  const headers = { Authorization: `Bearer ${token.access_token}` };
  const [user, guilds] = await Promise.all([
    discordJson(discordAPI + "/users/@me", { headers }),
    discordJson(discordAPI + "/users/@me/guilds?limit=200", { headers }),
  ]);
  if (!snowflake.test(user.id) || user.bot || !Array.isArray(guilds)) throw new Error("Invalid Discord account");
  return {
    id: user.id,
    name: String(user.global_name || user.username || "Discord user").slice(0, 80),
    username: String(user.username || "").slice(0, 40),
    avatar: /^(a_)?[a-f0-9]{32}$/.test(user.avatar || "")
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=64` : null,
    guilds: [...new Set(guilds.filter(guild => snowflake.test(guild?.id)).map(guild => guild.id))],
  };
}
