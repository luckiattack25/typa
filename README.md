# EchoType

Enter any artist and song. EchoType finds the artwork and lyrics, then types them out as an interactive, 3D music visualizer.

No build step, no backend, no database — it's a static site that calls public APIs directly from the browser.

## How it works

1. You type an artist and song title.
2. [iTunes Search API](https://performance-partners.apple.com/search-api) resolves the track: confirmed artist, title, album, and cover artwork.
3. Lyrics are looked up in two steps:
   - **Primary:** a Fandom lyrics wiki, queried through the public MediaWiki API (`action=query`/`action=parse` with `origin=*`, which Fandom exposes for browser-side CORS access — no proxy needed).
   - **Fallback:** [lyrics.ovh](https://lyricsovh.docs.apiary.io/), a free, keyless lyrics API, used only if Fandom has nothing.
4. The lyrics are typed out on screen at a steady pace you control, with play, pause, restart, a speed selector, and a scrub bar showing percent complete.
5. The album art sits in a cursor-reactive 3D tilt card with an amber spotlight sheen; a very low-opacity digital rain animation runs behind the glass panels.

## Project structure

```
index.html
css/style.css          -- design tokens, layout, all styling
js/rain.js              -- ambient digital rain canvas
js/tilt.js              -- cursor-reactive 3D tilt for album art
js/lyrics-providers.js  -- iTunes + Fandom + lyrics.ovh fetch logic
js/app.js               -- state machine + typewriter playback engine
.github/workflows/deploy.yml -- auto-deploys to GitHub Pages on push to main
```

## Running locally

Any static file server works — the app makes no server-side calls of its own.

```bash
cd echotype
python3 -m http.server 8080
# open http://localhost:8080
```

Opening `index.html` directly via `file://` will also mostly work, but some
browsers restrict `fetch` from `file://` origins — a local server avoids that.

## Deploying to GitHub Pages

**Option A — push to a new repo (recommended, fully automatic):**

```bash
cd echotype
git init
git add .
git commit -m "Initial commit: EchoType"
git branch -M main
git remote add origin https://github.com/<your-username>/echotype.git
git push -u origin main
```

Then in the repo on GitHub: **Settings → Pages → Build and deployment → Source → GitHub Actions**.
The included workflow (`.github/workflows/deploy.yml`) will build and publish automatically on every push to `main`. Your site will be live at:

```
https://<your-username>.github.io/echotype/
```

**Option B — no Actions, serve straight from the branch:**

**Settings → Pages → Build and deployment → Source → Deploy from a branch → `main` / `(root)`**. No workflow required, but you'll need to re-check that setting if you ever rename the default branch.

## Notes & limitations (by design, for the MVP)

- No accounts, playlists, database, streaming, uploads, or history — matches the MVP scope exactly.
- Lyrics availability depends entirely on what the two sources have indexed; some tracks (especially very new or very obscure ones) may come back with a "lyrics not available" message.
- Artwork and metadata come from Apple's public catalog via iTunes Search — tracks not in that catalog won't resolve.
- Lyrics are fetched at runtime from third-party sources for personal use; nothing is cached, stored, or redistributed by the app itself.
