(() => {
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const arrow = document.querySelector(".hero-scroll");
  const hero = document.querySelector(".hero");
  if (arrow && hero) {
    const update = () => {
      arrow.classList.toggle("is-away", hero.getBoundingClientRect().top < -64);
    };
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("pageshow", update);
    update();
  }

  const categories = document.querySelectorAll(".feature-index a");
  if (categories.length) {
    const setCurrentCategory = () => {
      categories.forEach(link => {
        if (link.hash === location.hash) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      });
    };
    window.addEventListener("hashchange", setCurrentCategory);
    setCurrentCategory();
  }

  const stats = document.querySelector(".stats-strip");
  if (!stats) return;
  const status = stats.querySelector(".stats-status");
  const fields = Array.from(stats.querySelectorAll("[data-stat]"));
  const format = new Intl.NumberFormat();

  const refreshMs = 120_000;
  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
  let latest = Date.parse(stats.dataset.snapshotAt);
  let config;
  let loading = false;
  let lastAttempt = -Infinity;

  async function getJSON(url, accept = "application/json") {
    const timer = new AbortController();
    const timeout = setTimeout(() => timer.abort(), 4500);
    try {
      const response = await fetch(url, {
        cache: "no-store", credentials: "omit", redirect: "error", signal: timer.signal,
        headers: { Accept: accept },
      });
      if (!response.ok) throw new Error("Stats unavailable");
      const date = Date.parse(response.headers.get("Date"));
      const age = Number(response.headers.get("Age"));
      const time = Number.isFinite(date) ? date + Math.max(0, age || 0) * 1000 : null;
      return { body: await response.json(), time, checkedAt: performance.now() };
    } finally {
      clearTimeout(timeout);
    }
  }

  function setStatus(label) {
    const iso = new Date(latest).toISOString();
    if (status.firstChild?.nodeValue === label && status.querySelector("time")?.dateTime === iso) return;
    const time = document.createElement("time");
    time.dateTime = iso;
    time.textContent = dateFormat.format(latest);
    status.replaceChildren(label, time);
  }

  async function getTotals(endpoint, accept, now) {
    const url = new URL(endpoint, location.href);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid stats URL");
    url.searchParams.set("refresh", Math.floor(now / refreshMs));
    const { body: totals } = await getJSON(url, accept);
    const stamp = Date.parse(totals?.updated_at);
    const age = now - stamp;
    if (!Number.isFinite(age) || age < -300_000 || age > 1_200_000 || stamp < latest ||
        !fields.every(node => Number.isSafeInteger(totals[node.dataset.stat]) && totals[node.dataset.stat] >= 0)) {
      throw new Error("Invalid or stale stats");
    }
    return { totals, stamp };
  }

  async function showStats() {
    if (document.hidden || loading || performance.now() - lastAttempt < refreshMs - 1000) return;
    loading = true;
    lastAttempt = performance.now();
    try {
      config ??= await getJSON("assets/stats-source.json?v=periodic");
      const { endpoint, fallback } = config.body;
      if (typeof endpoint !== "string" || !endpoint) throw new Error("Missing stats URL");
      const now = config.time === null ? Date.now() : config.time + performance.now() - config.checkedAt;
      let data;
      try {
        data = await getTotals(endpoint, "application/vnd.github.raw+json", now);
      } catch (error) {
        if (typeof fallback !== "string" || !fallback) throw error;
        data = await getTotals(fallback, "application/json", now);
      }
      const { totals, stamp } = data;
      fields.forEach(node => {
        const formatted = format.format(totals[node.dataset.stat]);
        if (node.textContent === formatted) return;
        node.textContent = formatted;
        const rect = node.getBoundingClientRect();
        if (!motion.matches && rect.bottom > 0 && rect.top < innerHeight) {
          node.animate(
            [{ opacity: .35, transform: "translateY(4px)" }, { opacity: 1, transform: "translateY(0)" }],
            { duration: 360, easing: "ease-out" },
          );
        }
      });
      latest = stamp;
      setStatus("Last checked ");
    } catch {
      // Keep the last validated values and their timestamp.
      setStatus("Last verified snapshot ");
    } finally {
      loading = false;
    }
  }

  void showStats();
  window.setInterval(showStats, refreshMs);
  document.addEventListener("visibilitychange", showStats);
})();
