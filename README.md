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

The website reads a timestamped JSON snapshot from the separate [stats repository](https://github.com/Duncanmmm123/roblotracker-stats). The EC2 timer checks the bot's private loopback endpoint every 15 minutes and publishes when the counts change or the last snapshot is an hour old. The file contains only `tracked_accounts`, `discord_servers`, and `updated_at`. The homepage includes the last verified counts and their timestamp in its HTML. It replaces them with a newer verified snapshot when the HTTPS request succeeds. A fetched snapshot more than two hours old cannot replace the published fallback.

The publisher and systemd units are in `ops/`. The service runs as `ubuntu` and expects its dedicated deploy key and GitHub host entry under `~/.config/rt-site-stats/`. Keep that deploy key limited to the stats repository. For a manual refresh run `sudo systemctl start rt-site-stats.service`. Check the last run with `sudo journalctl -u rt-site-stats.service -n 15 --no-pager`. The bot can continue running while the exporter is stopped.


## Discord installation

Use `https://roblotracker.github.io/install/` as the custom install link in the Discord Developer Portal. The site's Add buttons lead to this page. The page continues directly to Discord with the bot and slash-command scopes, the server installation context, and the same permission bitfield as the bot's `/invite` command. Keep the full authorization link on the page so it can open the Discord flow independently of the custom URL. This flow does not use an OAuth callback.
