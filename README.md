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
