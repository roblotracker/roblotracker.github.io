const status = document.querySelector("#join-status");
const confirmation = document.querySelector("#join-confirmation");
const fallback = "../assets/rt-logo.webp";

function decode(value) {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), character => character.charCodeAt(0));
}

function avatarUrl(value) {
  try {
    const url = new URL(value);
    const allowed = url.hostname === "rbxcdn.com" || url.hostname.endsWith(".rbxcdn.com");
    if (url.protocol === "https:" && allowed && !url.username && !url.password && !url.port) return url.href;
  } catch {
    // A missing or unavailable avatar uses the local RT logo.
  }
  return fallback;
}

function unavailable() {
  confirmation.hidden = true;
  status.hidden = false;
  status.textContent = "This join link is missing, invalid, or expired. Request a fresh link in Discord with /join-friend open.";
}

async function confirmJoin() {
  const fragment = window.location.hash.slice(1);
  if (!/^[A-Za-z0-9_-]{1,1800}\.[A-Za-z0-9_-]{86}$/.test(fragment)) return unavailable();
  const [data, signature] = fragment.split(".").map(decode);
  const response = await fetch("../assets/join-public-key.json");
  if (!response.ok) return unavailable();
  const key = await crypto.subtle.importKey("jwk", await response.json(), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  if (!await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, data)) return unavailable();
  const { userId, username, avatar, exp } = JSON.parse(new TextDecoder().decode(data));
  if (typeof userId !== "string" || !/^[1-9][0-9]{0,18}$/.test(userId) ||
      typeof username !== "string" || !/^[A-Za-z0-9_]{3,20}$/.test(username) ||
      !Number.isSafeInteger(exp) || exp * 1000 <= Date.now()) return unavailable();
  document.querySelector("#join-username").textContent = `@${username}`;
  const image = document.querySelector("#join-avatar");
  image.addEventListener("error", () => { image.src = fallback; }, { once: true });
  image.src = avatarUrl(avatar);
  const launch = document.querySelector("#join-launch");
  launch.href = `roblox://userId=${userId}`;
  launch.addEventListener("click", event => {
    if (exp * 1000 <= Date.now()) {
      event.preventDefault();
      unavailable();
    }
  });
  document.querySelector("#join-profile").href = `https://www.roblox.com/users/${userId}/profile`;
  status.hidden = true;
  confirmation.hidden = false;
  window.setTimeout(unavailable, Math.max(0, exp * 1000 - Date.now()));
}

confirmJoin().catch(unavailable);
