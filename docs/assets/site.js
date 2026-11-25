(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let storage;
  try {
    storage = window.sessionStorage;
  } catch {
    // Effects can still run when session storage is unavailable.
  }

  function readFlag(key) {
    try { return storage?.getItem(key) === "1"; } catch { return false; }
  }

  function setFlag(key, value) {
    try {
      if (value) storage?.setItem(key, "1");
      else storage?.removeItem(key);
    } catch {
      // Navigation works without storage.
    }
  }

  const brand = document.querySelector(".brand-home");
  const brandText = brand?.querySelector("span");
  let colorAnimation;
  function flashBrand() {
    if (reduceMotion.matches || !brandText?.animate) return;
    colorAnimation?.cancel();
    colorAnimation = brandText.animate(
      [{ color: "#fff" }, { color: "#65ddff" }, { color: "#a9a0ff" }, { color: "#fff" }],
      { duration: 720, easing: "ease-in-out" },
    );
  }

  const intro = document.querySelector(".site-intro");
  if (intro && !reduceMotion.matches && !readFlag("rt-site-intro")) {
    setFlag("rt-site-intro", true);
    intro.hidden = false;
    window.setTimeout(() => { intro.hidden = true; }, 620);
  }

  if (readFlag("rt-site-brand")) {
    setFlag("rt-site-brand", false);
    flashBrand();
  }

  brand?.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (document.body.classList.contains("landing")) {
      event.preventDefault();
      flashBrand();
      if (window.location.hash) history.replaceState(null, "", location.pathname + location.search);
      window.scrollTo({ top: 0, behavior: reduceMotion.matches ? "auto" : "smooth" });
    } else {
      setFlag("rt-site-brand", !reduceMotion.matches);
    }
  });

  const feedback = document.querySelector(".command-feedback");
  if (!feedback || !navigator.clipboard?.writeText) return;
  for (const row of document.querySelectorAll(".commands > div")) {
    const command = row.querySelector("code")?.textContent;
    const description = row.querySelector("dd");
    if (!command || !description) continue;
    const copy = document.createElement("button");
    copy.className = "copy-command";
    copy.type = "button";
    copy.textContent = "Copy";
    copy.setAttribute("aria-label", "Copy " + command);
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(command);
        feedback.textContent = "Copied " + command;
      } catch {
        feedback.textContent = "Couldn’t copy. Select the command text to copy it.";
      }
    });
    description.append(copy);
  }
})();
