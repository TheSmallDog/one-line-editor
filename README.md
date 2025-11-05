# Interactive One-Line — Editor + Viewer

- **Editor** (default): `http://localhost:5173/`
- **Viewer** (no editing UI): append `?mode=view`

## Run
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
npm run preview
```

## Deploy (GitHub Pages quick path)
1. Create a new repo on GitHub.
2. Upload/push these files.
3. Enable *Settings → Pages → Build and deploy → GitHub Actions* and accept the suggested workflow for static sites.
4. Share the URL with `?mode=view` for the viewer.