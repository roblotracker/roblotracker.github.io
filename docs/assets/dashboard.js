const api = "https://roblotracker-tracker-dashboard.install-verifier.workers.dev";
const snowflake = /^[1-9][0-9]{16,18}$/;
const storageKey = "rt-dashboard-session";
const oauthKey = "rt-dashboard-oauth";
const proofPattern = /^[a-f0-9]{64}$/;
const byId = id => document.getElementById(id);
const status = byId("dashboard-status");
const commandInput = byId("pair-command");
const search = byId("search");
const serverSearch = byId("server-search");
const activityType = byId("activity-type");
const signalSelect = byId("signal-select");
const trackerTabs = [...document.querySelectorAll(".profile-tabs a")];
const trackerSections = new Set(trackerTabs.map(tab => tab.dataset.section));
const content = byId("content");
const sidebarToggle = byId("sidebar-toggle");
const fullscreenToggle = byId("fullscreen-toggle");
const narrowViewport = matchMedia("(max-width: 780px)");
const sidebarKey = "rt-dashboard-sidebar";
let desktopCollapsed = false;
let mobileCollapsed = true;
const filterButtons = [...document.querySelectorAll(".tracker-filters [data-filter]")];
let trackerFilter = "all";
let searchGuild = null;
let token;
let inFlight = false;
let updateRequested = false;
let refreshTimer;
let viewRequest;
let loadingSince = null;
let trackers = [];
let sharedServers = [];
let activity = [];
let activityChannel = null;
let rendered = "";
let generation = 0;

try {
  token = localStorage.getItem(storageKey);
  desktopCollapsed = localStorage.getItem(sidebarKey) === "collapsed";
} catch {
  // The dashboard can still work for this tab.
}

function updateSidebar() {
  const collapsed = narrowViewport.matches ? mobileCollapsed : desktopCollapsed;
  content.dataset.sidebar = collapsed ? "collapsed" : "expanded";
  byId("workspace-rail").inert = narrowViewport.matches && collapsed;
  const description = collapsed ? "Expand sidebar" : "Collapse sidebar";
  sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
  sidebarToggle.setAttribute("aria-label", description);
  sidebarToggle.title = description;
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
  const section = params.get("section");
  const rawPage = params.get("page") || "";
  const signal = params.get("signal") || "";
  return {
    channel: snowflake.test(channel) ? channel : null,
    guild: snowflake.test(guild) ? guild : null,
    section: trackerSections.has(section) ? section : "overview",
    page: /^[1-9]\d{0,4}$/.test(rawPage) && Number(rawPage) <= 10000 ? Number(rawPage) : 1,
    signal: /^[a-z_]{0,32}$/.test(signal) ? signal : "",
  };
}

function serverRoute(guild, channel = null, section = "overview", page = 1, signal = "") {
  if (!guild && !channel) return "#";
  const params = new URLSearchParams();
  if (guild) params.set("server", guild);
  if (channel) params.set("tracker", channel);
  if (section !== "overview") params.set("section", section);
  if (page > 1) params.set("page", String(page));
  if (signal) params.set("signal", signal);
  return `#${params}`;
}

async function post(path, data = {}, authorization = token, requestSignal) {
  const timeout = AbortSignal.timeout(8000);
  const response = await fetch(api + path, {
    method: "POST",
    cache: "no-store",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}),
    },
    body: JSON.stringify(data),
    signal: requestSignal && AbortSignal.any ? AbortSignal.any([timeout, requestSignal]) : timeout,
  });
  if (response.status === 401) return { state: "expired" };
  if (!response.ok) throw new Error("Dashboard request failed");
  return response.json();
}

function showPanel(panel) {
  content.dataset.panel = panel || "loading";
  sidebarToggle.hidden = panel === "access";
  fullscreenToggle.hidden = !document.fullscreenEnabled || panel === "access";
  byId("workspace-location").hidden = true;
  byId("location-name").textContent = "";
  for (const id of ["access", "servers", "index", "detail", "denied"]) byId(id).hidden = id !== panel;
  byId("lock").hidden = !token;
  if (panel !== "servers") {
    sharedServers = [];
    byId("server-list").replaceChildren();
    byId("server-count").textContent = "";
  }
  if (panel !== "index") {
    trackers = [];
    byId("tracker-list").replaceChildren();
    byId("tracker-directory").hidden = true;
    byId("tracker-server").textContent = "";
    byId("tracker-server-icon").replaceChildren();
    byId("tracker-count").textContent = "";
  }
  if (panel !== "detail") {
    for (const id of ["account-name", "account-handle", "account-state", "last-checked", "account-game"]) byId(id).textContent = "";
    for (const id of ["account-profile", "account-channel"]) {
      byId(id).hidden = true;
      byId(id).removeAttribute("href");
    }
    setImage(byId("account-image"), null);
    activity = [];
    byId("activity-controls").hidden = true;
    byId("activity-list").replaceChildren();
    byId("record-list").replaceChildren();
    signalSelect.replaceChildren(new Option("All data", ""));
    byId("tracker-pages").hidden = true;
  }
}

function renderViewer(viewer, panel, guild, locationLabel) {
  const account = byId("viewer");
  account.hidden = !viewer;
  byId("viewer-name").textContent = viewer?.name || "";
  account.title = viewer?.username ? `Discord · @${viewer.username}` : "";
  setImage(byId("viewer-avatar"), viewer?.avatar);
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

function setTrackerFilter(value) {
  trackerFilter = value;
  for (const button of filterButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.filter === value));
  }
}

function setImage(image, src) {
  let url;
  if (typeof src === "string" && src.startsWith("https://")) {
    try {
      const candidate = new URL(src);
      const host = candidate.hostname;
      if (!candidate.username && !candidate.password && !candidate.port &&
          (host === "cdn.discordapp.com" || host === "rbxcdn.com" || host.endsWith(".rbxcdn.com"))) {
        url = candidate.href;
      }
    } catch {
      // Skip malformed image URLs from service responses.
    }
  }
  if (!url) {
    image.hidden = true;
    image.removeAttribute("src");
  } else if (image.getAttribute("src") !== url) {
    image.hidden = false;
    image.src = url;
  }
}

function rowImage(src, className, size, fallback) {
  const image = document.createElement("img");
  image.className = className;
  image.alt = "";
  image.width = image.height = size;
  image.loading = "lazy";
  image.decoding = "async";
  const showFallback = () => {
    if (fallback && image.getAttribute("src") !== fallback) {
      image.classList.add("server-icon-default");
      image.hidden = false;
      image.src = fallback;
    } else {
      image.hidden = true;
    }
  };
  image.addEventListener("error", showFallback);
  setImage(image, src);
  if (image.hidden && fallback) showFallback();
  return image;
}

function trackerRow(item, guild) {
  const li = document.createElement("li");
  const link = document.createElement("a");
  const title = document.createElement("span");
  const name = document.createElement("strong");
  const handle = document.createElement("small");
  const state = document.createElement("span");
  link.href = serverRoute(guild, item.channel);
  name.textContent = item.name || item.username;
  handle.textContent = `@${item.username}`;
  title.className = "row-title";
  title.append(name, handle);
  state.className = "row-state";
  state.dataset.paused = String(Boolean(item.paused));
  state.textContent = item.paused ? "Paused" : "Monitoring";
  link.append(rowImage(item.avatar, "tracker-avatar", 44), title, state);
  li.append(link);
  return li;
}

function renderServers() {
  const filter = serverSearch.value.trim().toLowerCase();
  const entries = sharedServers.filter(server => server.name.toLowerCase().includes(filter));
  byId("server-list").replaceChildren(...entries.map(server => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    const name = document.createElement("strong");
    const action = document.createElement("span");
    link.href = serverRoute(server.id);
    link.setAttribute("aria-label", `Open ${server.name}`);
    name.textContent = server.name;
    name.className = "server-name";
    action.className = "server-card-action";
    action.textContent = "Open server";
    link.append(rowImage(server.icon, "server-icon", 64, "../assets/discord.svg"), name, action);
    item.append(link);
    return item;
  }));
  const count = filter ? `${entries.length} of ${sharedServers.length}` : entries.length;
  byId("server-count").textContent = sharedServers.length ? `${count} shared ${sharedServers.length === 1 ? "server" : "servers"}` : "";
  byId("servers-empty").hidden = sharedServers.length !== 0;
  byId("servers-no-match").hidden = !sharedServers.length || entries.length !== 0;
}

function renderIndex() {
  const guild = currentRoute().guild;
  const filter = search.value.trim().toLowerCase().replace(/^@/, "");
  const matching = trackers.filter(item =>
    (trackerFilter === "all" || Boolean(item.paused) === (trackerFilter === "paused")) &&
    [item.username, item.name].some(value => (value || "").toLowerCase().includes(filter)));
  byId("tracker-list").replaceChildren(...matching.map(item => trackerRow(item, guild)));
  byId("tracker-directory").hidden = matching.length === 0;
  const count = filter || trackerFilter !== "all" ? `${matching.length} of ${trackers.length}` : matching.length;
  const countText = trackers.length ? `${count} ${trackers.length === 1 ? "tracker" : "trackers"}` : "";
  if (byId("tracker-count").textContent !== countText) byId("tracker-count").textContent = countText;
  byId("index-empty").hidden = matching.length > 0;
  byId("index-empty").textContent = trackers.length ? "No trackers match these filters." : "You don’t have access to any tracker channels in this server.";
}

const signalLabels = {
  presence: "Status change", avatar_appearance: "Outfit change", avatar_url: "Avatar change",
  friends: "Friend list change", friends_count: "Friend count change",
  username: "Username change", display_name: "Display name change", description: "Bio change",
};

function activityLabel(kind) {
  return Object.hasOwn(signalLabels, kind) ? signalLabels[kind] :
    (kind || "Update").replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
}

function activityRow(event) {
  const item = document.createElement("li");
  const link = document.createElement("a");
  const description = document.createElement("span");
  const title = document.createElement("strong");
  const date = document.createElement("time");
  link.href = event.link;
  title.textContent = activityLabel(event.kind);
  if (!Number.isNaN(Date.parse(event.when))) date.dateTime = event.when;
  date.textContent = timeText(event.when);
  description.append(title, date);
  const destination = document.createElement("span");
  destination.className = "activity-destination";
  destination.setAttribute("aria-hidden", "true");
  destination.textContent = "View in Discord";
  link.append(description, destination);
  item.append(link);
  if (event.before || event.after) {
    const changes = document.createElement("dl");
    changes.className = "history-change";
    for (const [label, value] of [["Before", event.before], ["After", event.after]]) {
      if (typeof value !== "string" || !value) continue;
      const field = document.createElement("div");
      const key = document.createElement("dt");
      const text = document.createElement("dd");
      key.textContent = label;
      text.textContent = value;
      field.append(key, text);
      changes.append(field);
    }
    item.append(changes);
  }
  return item;
}

function renderActivity() {
  const matches = activityType.value ? activity.filter(event => event.kind === activityType.value) : activity;
  byId("activity-list").replaceChildren(...matches.map(activityRow));
  byId("activity-empty").hidden = matches.length > 0;
  byId("activity-empty").textContent = activity.length ? "No alerts of this type." : "No delivered alerts in this channel yet.";
}

function renderDetail(tracker, guild, channel) {
  byId("account-name").textContent = tracker.name || tracker.username;
  byId("account-handle").textContent = `@${tracker.username}`;
  const state = byId("account-state");
  state.textContent = tracker.paused ? "Paused" : tracker.presence || "Presence unavailable";
  state.dataset.tone = ({ Online: "online", "In game": "game" })[state.textContent] || "neutral";
  byId("last-checked").textContent = timeText(tracker.checked);
  const showGame = !tracker.paused && tracker.presence === "In game";
  byId("game-observation").hidden = !showGame;
  byId("account-game").textContent = showGame ? tracker.game || "Name unavailable" : "";
  const profile = byId("account-profile");
  profile.hidden = !/^https:\/\/www\.roblox\.com\/users\/[1-9][0-9]{0,18}\/profile$/.test(tracker.profile || "");
  if (profile.hidden) profile.removeAttribute("href");
  else profile.href = tracker.profile;
  setImage(byId("account-image"), tracker.avatar);
  const channelLink = byId("account-channel");
  channelLink.hidden = !snowflake.test(guild) || !snowflake.test(channel);
  if (channelLink.hidden) channelLink.removeAttribute("href");
  else channelLink.href = `https://discord.com/channels/${guild}/${channel}`;
  const selectedType = activityChannel === channel ? activityType.value : "";
  activityChannel = channel;
  const channelPrefix = channelLink.hidden ? "" : channelLink.href + "/";
  activity = (tracker.activity || []).filter(event =>
    typeof event?.kind === "string" && /^https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+$/.test(event.link || "") &&
    event.link.startsWith(channelPrefix))
    .sort((left, right) => (Date.parse(right.when) || 0) - (Date.parse(left.when) || 0));
  const kinds = [...new Set(activity.map(event => event.kind))].sort((a, b) => activityLabel(a).localeCompare(activityLabel(b)));
  activityType.replaceChildren(new Option("All alerts", ""), ...kinds.map(kind => new Option(activityLabel(kind), kind)));
  activityType.value = kinds.includes(selectedType) ? selectedType : "";
  byId("activity-controls").hidden = kinds.length < 2;
  renderActivity();
}

function renderTrackerPage(route, data) {
  const { section = "overview", page = 1, signal = "" } = route;
  const guild = data.server?.id || route.guild;
  for (const tab of trackerTabs) {
    tab.href = serverRoute(guild, route.channel, tab.dataset.section);
    if (tab.dataset.section === section) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
  const observations = section === "observations";
  const history = section === "history";
  const meta = data.dashboard_page?.section === section && data.dashboard_page.number === page
    ? data.dashboard_page : null;
  byId("observations-panel").hidden = !observations;
  document.querySelector(".profile-activity").hidden = observations;
  byId("activity-title").textContent = history ? "Alert history" : "Recent activity";
  if (history) {
    byId("activity-controls").hidden = true;
    activityType.value = "";
    renderActivity();
    if (!meta) {
      byId("activity-empty").hidden = false;
      byId("activity-empty").textContent = "Full history becomes available after the bot is updated. This view shows recent alerts.";
    }
  }
  if (observations) {
    const signals = Array.isArray(meta?.signals) ? meta.signals : [];
    signalSelect.replaceChildren(new Option("All data", ""), ...signals.map(item => new Option(item.label, item.key)));
    signalSelect.value = signals.some(item => item.key === signal) ? signal : "";
    byId("signal-controls").hidden = signals.length === 0;
    const records = Array.isArray(meta?.records) ? meta.records : [];
    byId("record-list").replaceChildren(...records.map(record => {
      const row = document.createElement("div");
      const label = document.createElement("dt");
      const value = document.createElement("dd");
      label.textContent = record.label;
      value.textContent = record.value;
      row.append(label, value);
      return row;
    }));
    byId("record-empty").hidden = records.length !== 0;
    byId("record-empty").textContent = !meta ? "Saved observations become available after the bot is updated." :
      meta.total ? "This page has no observations." : "There are no saved observations for this selection.";
  }
  const pages = meta && Number.isInteger(meta.total) && Number.isInteger(meta.size) && meta.size > 0
    ? Math.max(1, Math.min(10000, Math.ceil(meta.total / meta.size))) : 1;
  byId("tracker-pages").hidden = !meta || (pages <= 1 && page === 1);
  byId("page-count").textContent = page > pages ? "Page unavailable" : `Page ${page} of ${pages}`;
  for (const [id, target, hidden] of [
    ["previous-page", Math.min(pages, page - 1), page <= 1],
    ["next-page", page + 1, page >= pages],
  ]) {
    const link = byId(id);
    link.hidden = hidden;
    if (hidden) link.removeAttribute("href");
    else link.href = serverRoute(guild, route.channel, section, target, signal);
  }
}

function locked(message) {
  viewRequest?.abort();
  setToken(null);
  clearTimeout(refreshTimer);
  loadingSince = null;
  rendered = "";
  commandInput.value = "";
  search.value = "";
  serverSearch.value = "";
  searchGuild = null;
  setTrackerFilter("all");
  byId("pairing").hidden = true;
  byId("pair").hidden = false;
  showPanel("access");
  renderViewer(null);
  status.textContent = message;
}

function showLoading(route) {
  showPanel(null);
  if (route.channel) {
    const tab = trackerTabs.find(item => item.dataset.section === route.section);
    status.textContent = tab && route.section !== "overview" ? `Loading ${tab.textContent.toLowerCase()}…` : "Loading tracker…";
  } else {
    status.textContent = route.guild ? "Loading trackers…" : "Loading servers…";
  }
}

function showUnavailable(route, viewer) {
  showPanel("denied");
  renderViewer(viewer, "denied", route.guild, route.channel ? "Tracker" : "Servers");
  status.textContent = "";
  byId("unavailable-title").textContent = route.channel ? "Tracker unavailable" : "Server unavailable";
  byId("unavailable-details").textContent = route.channel ?
    "Use the Discord account that can view this tracker channel and read its message history." :
    "Use a Discord account that shares this server with RobloTracker.";
  byId("unavailable-back").href = serverRoute(route.channel ? route.guild : null);
  byId("unavailable-back").textContent = route.channel && route.guild ? "Back to trackers" : "Back to servers";
}

async function refresh() {
  if (!token || document.hidden) return;
  clearTimeout(refreshTimer);
  if (inFlight) {
    updateRequested = true;
    return;
  }
  inFlight = true;
  const requestGeneration = generation;
  const route = currentRoute();
  const routeHash = location.hash;
  const request = new AbortController();
  viewRequest = request;
  let nextRefresh = 5000;
  try {
    const result = await post("/view", route, token, request.signal);
    if (generation !== requestGeneration || routeHash !== location.hash || document.hidden) return;
    if (result.state === "expired") return locked("Your session expired. Sign in again or use a new code.");
    if (result.state === "loading") {
      loadingSince ??= performance.now();
      if (performance.now() - loadingSince < 10_000) nextRefresh = 900;
    } else {
      loadingSince = null;
    }
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
        renderDetail(result.data.tracker, result.data.server?.id, route.channel);
        renderTrackerPage(route, result.data);
        renderViewer(result.viewer, "detail", result.data.server?.id, "Tracker profile");
      } else if (Array.isArray(result.data.servers)) {
        showPanel("servers");
        sharedServers = result.data.servers
          .filter(server => typeof server?.name === "string" && snowflake.test(server.id))
          .sort((left, right) => left.name.localeCompare(right.name));
        renderServers();
        renderViewer(result.viewer, "servers", null, "Servers");
      } else {
        showPanel("index");
        const guild = result.data.server?.id || route.guild;
        if (searchGuild !== guild) {
          searchGuild = guild;
          search.value = "";
          setTrackerFilter("all");
        }
        const server = result.data.server;
        byId("tracker-server").textContent = server?.name || "";
        byId("tracker-server-icon").replaceChildren(rowImage(server?.icon, "server-icon", 48, "../assets/discord.svg"));
        trackers = (result.data.trackers || []).filter(item => snowflake.test(item.channel));
        renderIndex();
        renderViewer(result.viewer, "index", result.data.server?.id, "Trackers");
      }
    } else {
      if (result.state === "denied") showUnavailable(route, result.viewer);
      else showLoading(route);
    }
  } catch {
    if (!request.signal.aborted && generation === requestGeneration && routeHash === location.hash && !document.hidden) {
      rendered = "";
      showPanel(null);
      status.textContent = "Connection interrupted. Reconnecting…";
    }
  } finally {
    if (viewRequest === request) viewRequest = null;
    inFlight = false;
    if (updateRequested) {
      updateRequested = false;
      refresh();
    } else if (token && !document.hidden) {
      refreshTimer = setTimeout(refresh, nextRefresh);
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
for (const id of ["account-image", "viewer-avatar"]) {
  byId(id).addEventListener("error", event => { event.currentTarget.hidden = true; });
}
activityType.addEventListener("change", renderActivity);
signalSelect.addEventListener("change", () => {
  const route = currentRoute();
  location.hash = serverRoute(route.guild, route.channel, "observations", 1, signalSelect.value);
});
search.addEventListener("input", renderIndex);
serverSearch.addEventListener("input", renderServers);
for (const button of filterButtons) {
  button.addEventListener("click", () => {
    setTrackerFilter(button.dataset.filter);
    renderIndex();
  });
}
document.querySelector(".skip").addEventListener("click", event => {
  event.preventDefault();
  content.focus();
});
sidebarToggle.addEventListener("click", () => {
  if (narrowViewport.matches) {
    mobileCollapsed = !mobileCollapsed;
  } else {
    desktopCollapsed = !desktopCollapsed;
    try {
      localStorage.setItem(sidebarKey, desktopCollapsed ? "collapsed" : "expanded");
    } catch {
      // Keep the preference in this tab when browser storage is unavailable.
    }
  }
  updateSidebar();
});
narrowViewport.addEventListener("change", updateSidebar);
updateSidebar();

fullscreenToggle.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    status.textContent = "Full screen is unavailable in this browser window.";
  }
});
document.addEventListener("fullscreenchange", () => {
  const active = Boolean(document.fullscreenElement);
  const description = active ? "Exit full screen" : "Full screen";
  fullscreenToggle.setAttribute("aria-pressed", String(active));
  fullscreenToggle.setAttribute("aria-label", description);
  fullscreenToggle.title = description;
});
window.addEventListener("hashchange", () => {
  if (!token) return;
  viewRequest?.abort();
  loadingSince = null;
  showLoading(currentRoute());
  rendered = "";
  refresh();
});
window.addEventListener("storage", event => {
  if (event.key !== storageKey || event.newValue === token) return;
  if (!event.newValue) return locked("Your dashboard is locked.");
  token = event.newValue;
  viewRequest?.abort();
  generation += 1;
  rendered = "";
  showLoading(currentRoute());
  refresh();
});
window.addEventListener("pagehide", () => {
  clearTimeout(refreshTimer);
  viewRequest?.abort();
  if (token) showPanel(null);
  rendered = "";
});
window.addEventListener("pageshow", event => {
  if (event.persisted) refresh();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearTimeout(refreshTimer);
    viewRequest?.abort();
    if (token) showPanel(null);
    rendered = "";
  } else {
    refresh();
  }
});
await finishSignIn();
showSignInOptions();
if (token) {
  showLoading(currentRoute());
  refresh();
}
byId("retry-view").addEventListener("click", () => {
  rendered = "";
  showLoading(currentRoute());
  refresh();
});
