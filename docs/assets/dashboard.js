const api = "https://roblotracker-tracker-dashboard.install-verifier.workers.dev";
const snowflake = /^[1-9][0-9]{16,18}$/;
const storageKey = "rt-dashboard-session";
const oauthKey = "rt-dashboard-oauth";
const proofPattern = /^[a-f0-9]{64}$/;
const byId = id => document.getElementById(id);
const status = byId("dashboard-status");
const commandInput = byId("pair-command");
const search = byId("search");
let token;
let inFlight = false;
let updateRequested = false;
let trackers = [];
let rendered = "";
let generation = 0;

try {
  token = localStorage.getItem(storageKey);
} catch {
  // The dashboard can still work for this tab.
}

function setToken(value) {
  token = value;
  generation += 1;
  try {
    if (value) localStorage.setItem(storageKey, value);
    else localStorage.removeItem(storageKey);
  } catch {
    // An in-memory session is sufficient.
  }
}

function currentRoute() {
  const hash = location.hash.slice(1);
  if (snowflake.test(hash)) return { channel: hash, guild: null };
  const params = new URLSearchParams(hash);
  const channel = params.get("tracker");
  const guild = params.get("server");
  return { channel: snowflake.test(channel) ? channel : null, guild: snowflake.test(guild) ? guild : null };
}

function serverRoute(guild, channel = null) {
  if (!guild) return channel ? `#${channel}` : "#";
  return `#server=${guild}${channel ? `&tracker=${channel}` : ""}`;
}

async function post(path, data = {}, authorization = token) {
  const response = await fetch(api + path, {
    method: "POST",
    cache: "no-store",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}),
    },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 401) return { state: "expired" };
  if (!response.ok) throw new Error("Dashboard request failed");
  return response.json();
}

function showPanel(panel) {
  byId("content").dataset.panel = panel || "loading";
  byId("workspace-location").hidden = true;
  byId("location-name").textContent = "";
  for (const id of ["access", "servers", "index", "detail", "denied"]) byId(id).hidden = id !== panel;
  byId("lock").hidden = !token;
  if (panel !== "servers") byId("server-list").replaceChildren();
  if (panel !== "index") {
    trackers = [];
    byId("tracker-list").replaceChildren();
  }
  if (panel !== "detail") {
    for (const id of ["account-name", "account-handle", "account-state", "last-checked", "account-game"]) byId(id).textContent = "";
    byId("account-profile").removeAttribute("href");
    byId("account-image").src = "../assets/rt-logo.webp";
    byId("activity-list").replaceChildren();
  }
}

function renderViewer(viewer, panel, guild, locationLabel) {
  const account = byId("viewer");
  account.hidden = !viewer;
  byId("viewer-name").textContent = viewer?.name || "";
  account.title = viewer?.username ? `Discord · @${viewer.username}` : "";
  byId("viewer-avatar").src = viewer?.avatar || "../assets/discord.svg";
  byId("lock").textContent = viewer ? "Sign out" : "Lock";
  const serversBack = byId("servers-back");
  serversBack.hidden = !viewer || !panel || panel === "access";
  const trackersBack = byId("trackers-back");
  trackersBack.hidden = panel !== "detail" && !(panel === "index" && viewer && guild);
  trackersBack.href = serverRoute(viewer ? guild : null);
  for (const [link, active] of [[serversBack, panel === "servers"], [trackersBack, panel === "index"]]) {
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  byId("workspace-nav").hidden = serversBack.hidden && trackersBack.hidden;
  byId("location-name").textContent = locationLabel || "";
  byId("workspace-location").hidden = !locationLabel;
}

function timeText(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function rowArrow() {
  const arrow = document.createElement("span");
  arrow.className = "row-arrow";
  arrow.textContent = "→";
  arrow.setAttribute("aria-hidden", "true");
  return arrow;
}

function trackerRow(item, guild) {
  const li = document.createElement("li");
  const link = document.createElement("a");
  const initial = document.createElement("span");
  const title = document.createElement("span");
  const name = document.createElement("strong");
  const handle = document.createElement("small");
  const state = document.createElement("span");
  link.href = serverRoute(guild, item.channel);
  initial.className = "tracker-initial";
  initial.setAttribute("aria-hidden", "true");
  name.textContent = item.name || item.username;
  initial.textContent = name.textContent.trim().slice(0, 2).toUpperCase();
  handle.textContent = `@${item.username}`;
  title.className = "row-title";
  title.append(name, handle);
  state.className = "row-state";
  state.textContent = item.paused ? "Paused" : "Monitoring";
  link.append(initial, title, state, rowArrow());
  li.append(link);
  return li;
}

function renderServers(servers) {
  const entries = (servers || []).filter(server => snowflake.test(server.id))
    .sort((left, right) => left.name.localeCompare(right.name));
  byId("server-list").replaceChildren(...entries.map(server => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    const icon = document.createElement("img");
    const name = document.createElement("span");
    link.href = serverRoute(server.id);
    icon.src = server.icon || "../assets/rt-logo.webp";
    icon.alt = "";
    icon.width = 38;
    icon.height = 38;
    icon.addEventListener("error", () => { icon.src = "../assets/rt-logo.webp"; }, { once: true });
    name.textContent = server.name;
    link.append(icon, name, rowArrow());
    item.append(link);
    return item;
  }));
  byId("server-count").textContent = entries.length ? `${entries.length} shared ${entries.length === 1 ? "server" : "servers"}` : "";
  byId("servers-empty").hidden = entries.length !== 0;
}

function renderIndex() {
  const guild = currentRoute().guild;
  const filter = search.value.trim().toLowerCase().replace(/^@/, "");
  const matching = trackers.filter(item =>
    [item.username, item.name].some(value => (value || "").toLowerCase().includes(filter)));
  byId("tracker-list").replaceChildren(...matching.map(item => trackerRow(item, guild)));
  const count = filter ? `${matching.length} of ${trackers.length}` : matching.length;
  byId("tracker-count").textContent = trackers.length ? `${count} ${trackers.length === 1 ? "tracker" : "trackers"}` : "";
  byId("index-empty").hidden = matching.length > 0;
  byId("index-empty").textContent = trackers.length ? "No trackers match your search." : "You don’t have access to any tracker channels in this server.";
}

const signalLabels = {
  presence: "Status change", avatar_appearance: "Outfit change", avatar_url: "Avatar change",
  friends: "Friend list change", friends_count: "Friend count change",
  username: "Username change", display_name: "Display name change", description: "Bio change",
};

function activityRow(event) {
  const item = document.createElement("li");
  const link = document.createElement("a");
  const description = document.createElement("span");
  const title = document.createElement("strong");
  const date = document.createElement("time");
  link.href = event.link;
  title.textContent = signalLabels[event.kind] ||
    (event.kind || "Update").replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
  if (!Number.isNaN(Date.parse(event.when))) date.dateTime = event.when;
  date.textContent = timeText(event.when);
  description.append(title, date);
  link.append(description, rowArrow());
  item.append(link);
  return item;
}

function renderDetail(tracker) {
  byId("account-name").textContent = tracker.name || tracker.username;
  byId("account-handle").textContent = `@${tracker.username}`;
  const state = byId("account-state");
  state.textContent = tracker.paused ? "Paused" : tracker.presence || "Presence unavailable";
  state.dataset.tone = ({ Online: "online", "In game": "game" })[state.textContent] || "neutral";
  byId("last-checked").textContent = timeText(tracker.checked);
  byId("account-game").textContent = tracker.presence === "In game" ? tracker.game || "Name unavailable" : "Unavailable";
  const profile = byId("account-profile");
  profile.hidden = !/^https:\/\/www\.roblox\.com\/users\/[1-9][0-9]{0,18}\/profile$/.test(tracker.profile || "");
  if (profile.hidden) profile.removeAttribute("href");
  else profile.href = tracker.profile;
  const image = byId("account-image");
  image.src = tracker.avatar || "../assets/rt-logo.webp";
  const events = (tracker.activity || []).filter(event =>
    /^https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+$/.test(event.link || ""));
  byId("activity-list").replaceChildren(...events.map(activityRow));
  byId("activity-empty").hidden = events.length > 0;
}

function locked(message) {
  setToken(null);
  rendered = "";
  commandInput.value = "";
  byId("pairing").hidden = true;
  byId("pair").hidden = false;
  showPanel("access");
  renderViewer(null);
  status.textContent = message;
}

async function refresh() {
  if (!token || document.hidden) return;
  if (inFlight) {
    updateRequested = true;
    return;
  }
  inFlight = true;
  const requestGeneration = generation;
  const route = currentRoute();
  const routeHash = location.hash;
  try {
    const result = await post("/view", route);
    if (generation !== requestGeneration || routeHash !== location.hash || document.hidden) return;
    if (result.state === "expired") return locked("This session expired. Get a new code to continue.");
    const marker = `${routeHash}:${result.state}:${result.updated || ""}`;
    if (rendered === marker) return;
    rendered = marker;
    if (result.state === "pending") {
      showPanel("access");
      renderViewer(null);
      byId("pair").hidden = true;
      byId("pairing").hidden = false;
      byId("code-access").open = true;
      commandInput.value = result.code;
      status.textContent = "After you enter your code in Discord, your profile will load here automatically.";
    } else if (result.state === "ready" && result.data) {
      status.textContent = `Updated ${timeText(result.updated)}`;
      if (result.data.tracker) {
        showPanel("detail");
        renderDetail(result.data.tracker);
        renderViewer(result.viewer, "detail", result.data.server?.id, "Tracker profile");
      } else if (result.data.servers) {
        showPanel("servers");
        renderServers(result.data.servers);
        renderViewer(result.viewer, "servers", null, "Servers");
      } else {
        showPanel("index");
        byId("tracker-server").textContent = result.data.server?.name || "";
        trackers = (result.data.trackers || []).filter(item => snowflake.test(item.channel));
        renderIndex();
        renderViewer(result.viewer, "index", result.data.server?.id, "Trackers");
      }
    } else {
      const panel = result.state === "denied" ? "denied" : null;
      showPanel(panel);
      renderViewer(result.viewer, panel);
      status.textContent = result.state === "denied" ? "This channel couldn’t be verified." : "Checking your Discord access…";
    }
  } catch {
    if (generation === requestGeneration) {
      rendered = "";
      showPanel(null);
      status.textContent = "Connection interrupted. Reconnecting…";
    }
  } finally {
    inFlight = false;
    if (updateRequested) {
      updateRequested = false;
      refresh();
    }
  }
}

byId("pair").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await post("/pair", { channel: currentRoute().channel }, null);
    setToken(result.token);
    await refresh();
  } catch {
    status.textContent = "Couldn’t create a code. Try again in a moment.";
  } finally {
    button.disabled = false;
  }
});

byId("sign-in").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await post("/oauth/start", {}, null);
    const address = new URL(result.url);
    if (address.origin !== "https://discord.com" || address.pathname !== "/oauth2/authorize" ||
        !proofPattern.test(result.proof)) throw new Error("Invalid Discord sign-in request");
    sessionStorage.setItem(oauthKey, JSON.stringify({ proof: result.proof, hash: location.hash }));
    location.assign(address.href);
  } catch {
    status.textContent = "Couldn’t start Discord sign-in. Try again or use a one-time code.";
    button.disabled = false;
  }
});

async function finishSignIn() {
  const handoff = new URLSearchParams(location.hash.slice(1)).get("oauth");
  if (handoff === null) return;
  let saved;
  try {
    saved = JSON.parse(sessionStorage.getItem(oauthKey) || "null");
    sessionStorage.removeItem(oauthKey);
  } catch {
    saved = null;
  }
  const fallbackHash = saved?.hash?.startsWith("#") && !saved.hash.startsWith("#oauth=") ? saved.hash : "";
  history.replaceState(null, "", location.pathname + fallbackHash);
  if (!proofPattern.test(handoff) || !proofPattern.test(saved?.proof || "")) {
    status.textContent = "Discord sign-in didn’t finish. Try again or use a one-time code.";
    return;
  }
  try {
    const result = await post("/oauth/finish", { handoff, proof: saved.proof }, null);
    if (!proofPattern.test(result.token || "")) throw new Error("Session was not created");
    setToken(result.token);
  } catch {
    status.textContent = "Discord sign-in expired. Try again or use a one-time code.";
  }
}

async function showSignInOptions() {
  try {
    const result = await post("/capabilities", {}, null);
    byId("sign-in").hidden = !result.discordSignIn;
    byId("oauth-unavailable").hidden = Boolean(result.discordSignIn);
    if (!result.discordSignIn) showCodeSignIn();
  } catch {
    byId("oauth-unavailable").hidden = false;
    showCodeSignIn();
  }
}

function showCodeSignIn() {
  byId("code-access").open = true;
  byId("pair").classList.remove("secondary");
}

byId("lock").addEventListener("click", () => {
  const previous = token;
  locked("Your dashboard is locked.");
  post("/lock", {}, previous).catch(() => {});
});

byId("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(commandInput.value);
    status.textContent = "Code copied. Paste it into /tracker-dashboard in Discord.";
  } catch {
    commandInput.select();
  }
});
byId("account-image").addEventListener("error", event => {
  const image = event.currentTarget;
  if (!image.src.endsWith("/rt-logo.webp")) image.src = "../assets/rt-logo.webp";
});
byId("viewer-avatar").addEventListener("error", event => {
  const image = event.currentTarget;
  if (!image.src.endsWith("/discord.svg")) image.src = "../assets/discord.svg";
});
search.addEventListener("input", renderIndex);
window.addEventListener("hashchange", () => {
  if (!token) return;
  showPanel(null);
  rendered = "";
  refresh();
});
window.addEventListener("storage", event => {
  if (event.key !== storageKey || event.newValue === token) return;
  if (!event.newValue) return locked("Your dashboard is locked.");
  token = event.newValue;
  generation += 1;
  rendered = "";
  showPanel(null);
  refresh();
});
window.addEventListener("pagehide", () => {
  if (token) showPanel(null);
  rendered = "";
});
window.addEventListener("pageshow", event => {
  if (event.persisted) refresh();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (token) showPanel(null);
    rendered = "";
  } else {
    refresh();
  }
});
window.setInterval(() => { if (!document.hidden) refresh(); }, 5000);
await finishSignIn();
showSignInOptions();
if (token) { showPanel(null); refresh(); }
