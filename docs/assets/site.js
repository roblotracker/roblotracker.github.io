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

  const directory = document.querySelector(".command-directory");
  if (directory) {
    const reveal = hash => {
      if (!hash.startsWith("#command-")) return;
      const target = document.getElementById(hash.slice(1));
      if (target && directory.contains(target)) {
        directory.open = true;
        return target;
      }
    };
    const revealCurrent = () => {
      const target = reveal(location.hash);
      if (target) requestAnimationFrame(() => target.scrollIntoView());
    };
    document.querySelectorAll('a[href^="#command-"]').forEach(link => {
      link.addEventListener("click", () => reveal(link.hash));
    });
    window.addEventListener("hashchange", revealCurrent);
    revealCurrent();
  }

  document.querySelectorAll(".faq details").forEach(details => {
    const question = details.querySelector("summary");
    const answer = details.querySelector(".faq-answer");
    let slide;
    let opening = false;

    question.addEventListener("click", event => {
      if (!answer.animate) return;
      if (motion.matches) {
        if (slide) {
          slide.cancel();
          slide = null;
          answer.style.overflow = "";
          details.open = opening;
          details.classList.remove("is-closing");
        }
        return;
      }
      event.preventDefault();
      const height = answer.getBoundingClientRect().height;
      opening = slide ? !opening : !details.open;
      slide?.cancel();
      details.open = true;
      details.classList.toggle("is-closing", !opening);
      answer.style.overflow = "hidden";
      slide = answer.animate(
        [{ height: `${height}px`, opacity: height ? 1 : 0 }, { height: `${opening ? answer.scrollHeight : 0}px`, opacity: opening ? 1 : 0 }],
        { duration: 220, easing: "ease-in-out" },
      );
      slide.onfinish = () => {
        details.open = opening;
        details.classList.remove("is-closing");
        answer.style.overflow = "";
        slide = null;
      };
    });
  });

  const stats = document.querySelector(".stats-strip");
  if (!stats) return;
  const fields = Array.from(stats.querySelectorAll("[data-stat]"));
  const format = new Intl.NumberFormat();
  const developerList = document.querySelector(".developer-list");
  const developerTemplate = document.querySelector("#developer-profile-template");
  const developerBios = new Map([
    ["britishpersonal", "Founder and developer of RobloTracker."],
    ["delandaasianman", "RobloTracker developer and friend of the founder."],
  ]);
  let currentRoster;

  const refreshMs = 120_000;
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

  function showDevelopers(roster) {
    if (!developerList || !developerTemplate || !Array.isArray(roster)) return;
    const entries = [];
    for (const profile of roster) {
      if (!profile || typeof profile.username !== "string" || typeof profile.avatar !== "string") return;
      if (!/^https:\/\/cdn\.discordapp\.com\/(?:avatars|guilds|embed\/avatars)\//.test(profile.avatar)) return;
      const entry = developerTemplate.content.cloneNode(true);
      const avatar = entry.querySelector("img");
      avatar.addEventListener("error", () => { avatar.src = "assets/rt-logo.webp"; }, { once: true });
      avatar.src = profile.avatar;
      entry.querySelector("h3").textContent = profile.username;
      entry.querySelector("p").textContent = developerBios.get(profile.username) ?? "RobloTracker developer.";
      entries.push(entry);
    }
    const key = JSON.stringify(roster);
    if (key === currentRoster) return;
    currentRoster = key;
    if (!entries.length) {
      const empty = document.createElement("li");
      empty.textContent = "No developers are currently listed.";
      entries.push(empty);
    }
    developerList.replaceChildren(...entries);
  }

  async function getTotals(endpoint, accept, now) {
    const url = new URL(endpoint, location.href);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid stats URL");
    url.searchParams.set("refresh", Math.floor(now / refreshMs));
    const { body: totals } = await getJSON(url, accept);
    const stamp = Date.parse(totals?.updated_at);
    const age = now - stamp;
    if (!Number.isFinite(age) || age < -300_000 || age > 1_200_000 || stamp < latest ||
        !["tracked_accounts", "discord_servers"].every(key => Number.isSafeInteger(totals[key]) && totals[key] >= 0)) {
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
        const value = totals[node.dataset.stat];
        if (!Number.isSafeInteger(value) || value < 0) return;
        const formatted = format.format(value);
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
      showDevelopers(totals.developers);
      latest = stamp;
    } catch {
      // Keep the last validated numbers and developer roster.
    } finally {
      loading = false;
    }
  }

  void showStats();
  window.setInterval(showStats, refreshMs);
  document.addEventListener("visibilitychange", showStats);
})();
