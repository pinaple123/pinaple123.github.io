# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file static site (`crazygames.html`) intended for deployment to GitHub Pages (`*.github.io`). No backend, no build step, no package manager — open it in a browser or push it to a Pages repo as `index.html`.

## Architecture constraints that matter

- **Static-only hosting.** Anything that needs a server (proxy, header rewriting, server-side fetch) is off the table. Don't suggest Bun/Node proxies, CORS-strippers, or service-worker URL rewriters as solutions — they can't run on GitHub Pages.
- **CrazyGames killed third-party iframing in 2026.** `https://www.crazygames.com/embed/<slug>` now returns `401 Unauthorized` + `X-Frame-Options: SAMEORIGIN`. The old approach is dead; do not suggest it.
- **The provider that does still allow iframing is GameDistribution (Azerion).** Their embed URLs at `https://html5.gamedistribution.com/<32-hex-id>/` return 200 with no `X-Frame-Options` and no `frame-ancestors` CSP. That's what `index.html` uses.

## Adding or fixing a game

GameDistribution game IDs are 32-character hex strings. The site is fully JS-rendered, so you cannot scrape IDs from page HTML. To find an ID for a new game, the reliable method is a web search for `"html5.gamedistribution.com" <game name>` — public sites that embed the game expose the ID in their iframe `src`. Verify with `curl -sI https://html5.gamedistribution.com/<id>/` — must return `200` with no `X-Frame-Options` header.

If a game card loads blank in the deployed site, the ID is stale (game removed from GD) — replace it.

## Deployment

This repo is deployed at https://pinaple123.github.io/ (GitHub Pages user site). Push to `main` and Pages rebuilds automatically. The local file is `index.html` (renamed from `crazygames.html`).

## Features in the page

- Grid + search filter rendered from `GAMES`.
- Click a card → loads `/embed/<slug>` in a fullscreen iframe overlay (`#player`). Esc closes.
- **Cloak** button opens an `about:blank` popup with the current page iframed inside, so the URL bar reads `about:blank`. This is purely cosmetic — it does not bypass any blocking, since `/embed/<slug>` already works without it.
