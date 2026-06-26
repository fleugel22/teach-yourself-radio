# I/Q Signal Primer

Two interactive lessons on I/Q radio data, built as React components and bundled
to run from static files. React is loaded from a CDN (esm.sh) via an import map,
so the only local payload is the lesson code itself (~31 KB each).

## Files
- `index.html` — landing page linking to both lessons
- `foundations.html`, `part1.html`, `modulation.html`, `part2.html`, `receiver.html`, `part3.html`, `advanced.html`, `lora.html` — the lessons (import map + module script)
- `glossary.html` — standalone searchable glossary (no bundle; plain HTML/JS)
- a sticky course-nav bar (prev/next + jump-anywhere) is built into every page
- matching `*.js` — bundled lesson code (React kept external)
- `src/` — original `.jsx` source, if you want to edit and rebuild

## Host on GitHub Pages
1. Create a new repository and add **all** files from this folder at the repo root.
2. Commit and push to the `main` branch.
3. Repo → **Settings → Pages → Build and deployment** → Source: **Deploy from a branch**,
   Branch: **main**, folder: **/ (root)** → **Save**.
4. Wait ~1 minute. Your site is at `https://USERNAME.github.io/REPO/`.

The pages use ES modules + an import map, so they must be opened over http(s)
(GitHub Pages, or a local server) — **not** by double-clicking the file (`file://`).

## Preview locally before pushing
From this folder, run either:
```
npx serve
# or
python3 -m http.server 8000
```
then open the printed URL (e.g. http://localhost:8000).

## Rebuild after editing src/
```
npm i react react-dom            # only needed for the bundler to resolve imports
npx esbuild src/iq-explorer.jsx --bundle --minify --format=esm \
  --jsx=automatic --packages=external --outfile=part1.js
```
(Each lesson's default export is the `App` component; the entry just renders it
with `createRoot`. The `--jsx=automatic` flag is important — without it the build
expects a global `React` and the page renders blank.)

## Swapping the CDN
The import map in each HTML points at esm.sh. To use a different CDN, change the
three URLs (`react`, `react/jsx-runtime`, `react-dom/client`) to e.g. jsDelivr or
unpkg ESM builds, keeping the versions identical so React and ReactDOM match.
