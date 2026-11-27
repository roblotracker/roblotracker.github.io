const api = "https://roblotracker-tracker-dashboard.install-verifier.workers.dev";
const snowflake = /^[1-9][0-9]{16,18}$/;
const storageKey = "rt-dashboard-session";
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

function currentChannel() {
  const hash = location.hash.slice(1);
  return snowflake.test(hash) ? hash : null;
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
  for (const id of ["access", "index", "detail", "denied"]) byId(id).hidden = id !== panel;
  byId("lock").hidden = !token;
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

function timeText(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function linkRow(text, secondary, href, time = false) {
  const li = document.createElement("li");
  const a = document.createElement("a");
  const metadata = document.createElement(time ? "time" : "small");
  a.href = href;
  a.textContent = text;
  metadata.textContent = secondary;
  a.append(metadata);
  li.append(a);
  return li;
}

function renderIndex() {
  const filter = search.value.trim().toLowerCase().replace(/^@/, "");
  const matching = trackers.filter(item => snowflake.test(item.channel) &&
    [item.username, item.name].some(value => String(value).toLowerCase().includes(filter)));
  byId("tracker-list").replaceChildren(...matching.map(item =>
    linkRow(`@${item.username}`, item.paused ? "Paused" : item.name, `#${item.channel}`)));
  byId("index-empty").hidden = matching.length > 0;
  byId("index-empty").textContent = trackers.length ? "No trackers match your search." : "You don’t have access to any tracker channels in this server.";
}

function renderDetail(tracker) {
  byId("account-name").textContent = tracker.name || tracker.username;
  byId("account-handle").textContent = `@${tracker.username}`;
  byId("account-state").textContent = tracker.paused ? "Paused" : tracker.presence || "Presence unavailable";
  byId("last-checked").textContent = timeText(tracker.checked);
  byId("account-game").textContent = tracker.presence === "In game" ? tracker.game || "Name unavailable" : "Unavailable";
  if (/^https:\/\/www\.roblox\.com\/users\/[1-9][0-9]{0,18}\/profile$/.test(tracker.profile || "")) {
    byId("account-profile").href = tracker.profile;
  }
  const image = byId("account-image");
  image.src = tracker.avatar || "../assets/rt-logo.webp";
  const events = (tracker.activity || []).filter(event =>
    /^https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+$/.test(event.link || ""));
  byId("activity-list").replaceChildren(...events.map(event => linkRow(
    (event.kind || "Update").replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase()),
    timeText(event.when), event.link, true,
  )));
  byId("activity-empty").hidden = events.length > 0;
}

function locked(message) {
  setToken(null);
  rendered = "";
  commandInput.value = "";
  byId("pairing").hidden = true;
  byId("pair").hidden = false;
  showPanel("access");
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
  const channel = currentChannel();
  try {
    const result = await post("/view", { channel });
    if (generation !== requestGeneration || channel !== currentChannel() || document.hidden) return;
    if (result.state === "expired") return locked("This session expired. Get a new code to continue.");
    const marker = `${channel || ""}:${result.state}:${result.updated || ""}`;
    if (rendered === marker) return;
    rendered = marker;
    if (result.state === "pending") {
      showPanel("access");
      byId("pair").hidden = true;
      byId("pairing").hidden = false;
      commandInput.value = result.code;
      status.textContent = "Waiting for Discord to approve this browser.";
    } else if (result.state === "ready" && result.data) {
      status.textContent = `Updated ${timeText(result.updated)}`;
      if (result.data.tracker) {
        showPanel("detail");
        renderDetail(result.data.tracker);
      } else {
        showPanel("index");
        trackers = result.data.trackers || [];
        renderIndex();
      }
    } else {
      showPanel(result.state === "denied" ? "denied" : null);
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
    const result = await post("/pair", { channel: currentChannel() }, null);
    setToken(result.token);
    await refresh();
  } catch {
    status.textContent = "Couldn’t create a code. Try again in a moment.";
  } finally {
    button.disabled = false;
  }
});

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
if (token) {
  showPanel(null);
  refresh();
}
