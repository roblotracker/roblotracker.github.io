(() => {
  if (new URLSearchParams(location.search).get("from") === "dashboard") {
    const note = document.querySelector("#dashboard-install-note");
    if (note) note.hidden = false;
  }
  const form = document.querySelector("#install-verification");
  if (!form || form.hidden || !form.dataset.sitekey || !form.dataset.verifier) return;

  const button = form.querySelector("button");
  const status = form.querySelector("#install-status");
  const challenge = form.querySelector("#install-challenge");
  let widget;
  let token = "";
  let pending = false;

  const reset = message => {
    token = "";
    button.disabled = true;
    status.textContent = message;
  };

  reset("Loading the security check…");
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.onerror = () => reset("The security check couldn’t load. Reload this page to try again.");
  script.onload = () => {
    try {
      widget = window.turnstile.render(challenge, {
        sitekey: form.dataset.sitekey,
        action: "rt_install",
        theme: "dark",
        size: "flexible",
        appearance: "always",
        callback: response => {
          token = response;
          status.textContent = "";
          button.disabled = pending;
        },
        "expired-callback": () => reset("The security check expired. Please try again."),
        "error-callback": () => {
          reset("The security check couldn’t finish. Please try again.");
          return true;
        },
      });
    } catch {
      reset("The security check couldn’t load. Reload this page to try again.");
    }
  };
  document.head.append(script);

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!token || pending) return;
    pending = true;
    button.disabled = true;
    status.textContent = "Verifying…";
    try {
      const response = await fetch(form.dataset.verifier, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        credentials: "omit",
        body: token,
        signal: AbortSignal.timeout(9000),
      });
      if (!response.ok) throw new Error("Verification rejected");
      const data = await response.json();
      const redirect = new URL(data.redirect);
      if (redirect.origin !== "https://discord.com" || redirect.pathname !== "/oauth2/authorize" ||
          redirect.searchParams.get("client_id") !== "1561527919375814709") {
        throw new Error("Invalid install link");
      }
      window.location.assign(redirect.href);
    } catch {
      pending = false;
      reset("Verification didn’t finish. Complete the security check and try again.");
      window.turnstile.reset(widget);
    }
  });
})();
