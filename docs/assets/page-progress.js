(() => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const root = document.documentElement;
  const started = performance.now();
  root.dataset.pageProgress = "loading";

  const watchdog = setTimeout(finish, 2400);
  if (document.readyState === "complete") finish();
  else addEventListener("load", finish, { once: true });

  function finish() {
    clearTimeout(watchdog);
    removeEventListener("load", finish);
    if (root.dataset.pageProgress !== "loading") return;
    setTimeout(() => {
      root.dataset.pageProgress = "complete";
      setTimeout(() => { delete root.dataset.pageProgress; }, 250);
    }, Math.max(0, 210 - (performance.now() - started)));
  }
})();
