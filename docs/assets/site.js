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

  const stats = document.querySelector(".stats-strip");
  if (!stats) return;
  const status = stats.querySelector(".stats-status");
  const fields = Array.from(stats.querySelectorAll("[data-stat]"));
  const format = new Intl.NumberFormat();

  async function getJSON(url) {
    const response = await fetch(url, {
      credentials: "omit", redirect: "error", signal: AbortSignal.timeout(4500),
    });
    if (!response.ok) throw new Error("Stats unavailable");
    return response.json();
  }

  async function showStats() {
    try {
      const { endpoint } = await getJSON("assets/stats-source.json");
      if (typeof endpoint !== "string" || !endpoint) return;
      const url = new URL(endpoint, location.href);
      if (url.protocol !== "https:" || url.username || url.password) return;
      const totals = await getJSON(url);
      if (!fields.every(node => Number.isSafeInteger(totals?.[node.dataset.stat]) && totals[node.dataset.stat] >= 0)) return;
      fields.forEach(node => {
        node.textContent = format.format(totals[node.dataset.stat]);
        node.removeAttribute("aria-label");
      });
      status.textContent = "Counts can lag by a few minutes.";
      if (motion.matches || !("IntersectionObserver" in window)) return;
      const observer = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        if (motion.matches) return;
        fields.forEach((node, index) => node.animate(
          [{ opacity: .3, transform: "translateY(5px)" }, { opacity: 1, transform: "translateY(0)" }],
          { duration: 420, delay: index * 75, easing: "cubic-bezier(.2,.72,.24,1)", fill: "backwards" },
        ));
      });
      observer.observe(stats);
    } catch {
      // Keep the unavailable state if the optional feed fails.
    }
  }

  void showStats();
})();
