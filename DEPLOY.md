# Deploying Blaze Roller to Vercel

This is a static Vite + TypeScript app (Babylon.js). It builds to `dist/` and is
served as static files — no server runtime needed.

## What's already configured

- **`vercel.json`** — framework preset (`vite`), build command (`npm run build`),
  output dir (`dist`), and cache headers: hashed assets are cached immutably for
  1 year, while `index.html` is never cached (so new deploys go live instantly).
- **`package.json`** — `engines.node >= 20`; **`.nvmrc`** pins Node 20 for the
  Vercel build image.
- Vite emits root-relative, content-hashed asset URLs (`/assets/...`), which is
  exactly what Vercel serves.

Vercel auto-detects the Vite framework, so most of `vercel.json` is belt-and-
suspenders / documentation; the caching headers are the part that actually adds value.

## Option A — Vercel CLI (no git required)

```bash
npm i -g vercel        # once
vercel                 # from this folder; follow prompts (creates the project)
vercel --prod          # promote to production
```

The CLI reads `vercel.json`, runs `npm run build`, and uploads `dist/`.

## Option B — Git + Vercel dashboard

```bash
git init
git add -A
git commit -m "Blaze Roller"
# create a repo on GitHub/GitLab/Bitbucket, add it as 'origin', then:
git push -u origin main
```

Then on vercel.com: **New Project → Import** the repo. Settings are picked up from
`vercel.json` automatically. Framework: Vite, Build: `npm run build`, Output: `dist`.
Every push builds a preview; pushes to the default branch deploy to production.

## Local verification (matches what Vercel builds)

```bash
npm ci        # clean install from package-lock.json (what CI uses)
npm run build # -> dist/
npm run preview  # serves the production build locally to sanity-check
```

## Notes

- The build prints a "chunk larger than 500 kB" warning — expected (Babylon.js
  core). The initial payload is ~278 KB gzipped; the extra Babylon texture-loader
  chunks are lazy and never fetched at runtime (the game uses no external textures).
- No environment variables are required.
- The game does not lock orientation and is responsive (portrait-first, 9:16), so
  it works embedded in YouTube Playables and on desktop.
