# roblotracker GitHub Pages

This repository only contains the public website. It uses plain HTML and CSS, with the production pages rooted in `docs/`. The bot service and its configuration are maintained separately.

## Preview

Run `python -m http.server 8000 --directory docs` from this folder and open `http://localhost:8000/`.

## Publish

In the website repository’s **Settings → Pages**, select **Deploy from a branch**, **main**, and **/docs**. Each push to `main` updates the site. The untouched `docs/.nojekyll` file enables static file serving.

Use `/privacy.html` and `/terms.html` under the deployed Pages base URL for the app’s Privacy Policy and Terms of Service fields in the Discord Developer Portal. Contact and install links are ordinary Discord URLs. When configuration or data handling changes, update each affected page and its revision date.

The site also serves short links at `/privacy/` and `/terms/`. The alternate `/pysics/` spelling opens the Privacy Policy.

## Public address

The primary GitHub Pages site is https://roblotracker.github.io/. Its publishing source is the `/docs` folder on the `main` branch of `roblotracker/roblotracker.github.io`.

## Public usage totals

The website reads a timestamped JSON snapshot from the separate [stats repository](https://github.com/Duncanmmm123/roblotracker-stats). The EC2 timer checks the bot's private loopback endpoints every two minutes and publishes when the totals or roster change, or the last snapshot is at least five minutes old. It publishes aggregate counts and the usernames and global avatar URLs of members with the Developer’s role in RT Support. The website supplies the team bios because the Discord bot API does not expose profile bios. An open homepage refreshes every two minutes while visible and on return to the tab when a check is due. A fetched snapshot more than 20 minutes old cannot replace the saved fallback.

The publisher and systemd units are in `ops/`. The service runs as `ubuntu` and expects its dedicated deploy key and GitHub host entry under `~/.config/rt-site-stats/`. Keep that deploy key limited to the stats repository. For a manual refresh run `sudo systemctl start rt-site-stats.service`. Check the last run with `sudo journalctl -u rt-site-stats.service -n 15 --no-pager`. The bot can continue running while the exporter is stopped.


## Discord installation

Use `https://roblotracker.github.io/install/` as the custom install link in the Discord Developer Portal. The site's Add buttons lead to this page. The page continues to Discord with the bot and slash-command scopes, the server installation context, and the same permission bitfield as the bot's `/invite` command. The direct authorization link is used until CAPTCHA is activated. This flow does not use an OAuth callback.

### Activate the install CAPTCHA

1. In Cloudflare Turnstile, create a **Managed** widget for `roblotracker.github.io`.
2. In `ops/install-verifier`, run `npx wrangler login`, then `npx wrangler deploy`. Run `npx wrangler secret put TURNSTILE_SECRET_KEY` and enter the widget secret when prompted. Use the Worker’s HTTPS URL ending in `/verify`.
3. In `docs/install/index.html`, put the public widget key in `data-sitekey` and the HTTPS Worker URL in `data-verifier`. Remove the form’s `hidden` attribute and the `#direct-install` link in the same commit.
4. After GitHub Pages deploys, open the install page and complete the check. Confirm the button opens the Discord server picker.

The Worker accepts tokens only after Cloudflare verifies the widget action and site hostname. The site sends no bot credentials to Cloudflare. This protects the website’s install flow. Discord controls its own authorization links and app installs.

## Private dashboard Discord sign-in

In the RobloTracker application’s OAuth2 settings, register
`https://roblotracker-tracker-dashboard.install-verifier.workers.dev/oauth/callback`
as a redirect. In `ops/tracker-dashboard` run `npx wrangler secret put DISCORD_CLIENT_SECRET`
and paste the application’s OAuth2 client secret at the prompt. Keep the secret
out of the repository. The dashboard requests only Discord’s `identify` and
`guilds` scopes. The bot verifies membership and tracker channel permissions
before returning tracker data. One-time Discord codes remain available.
