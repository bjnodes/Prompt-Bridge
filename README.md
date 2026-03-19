# Prompt Bridge

Korean prompt in, optimized English prompt out.

This project is a Node.js + Playwright app that opens a ChatGPT web session and uses that logged-in browser session to generate image/video prompts tailored to selected models.

## What this repo includes

- Prompt Bridge frontend UI
- Node app server
- Playwright browser automation
- ChatGPT web session reuse
- Cut-based workflow with thumbnails, model selection, multi-cut support, and prompt history

## Important

This app can be stored on GitHub, but it does **not** run on GitHub Pages alone.

It needs:

- a Node.js server
- Playwright / Chromium
- persistent storage if you want the ChatGPT login session to survive restarts

For deployment, use a server or container host such as a VPS, Docker host, Render, Railway, Fly.io, or another platform that supports long-running Node apps and browser automation.

## ChatGPT account model

The current backend architecture uses a server-side Playwright browser session.

That means:

- the browser session is created on the server
- the current implementation is **not** a true "each end user logs into their own ChatGPT account in their own browser" web architecture
- if you want true per-user ChatGPT accounts, this needs a different product shape such as a browser extension, desktop app, or a remote streamed browser system

ChatGPT Free accounts can still use ChatGPT on the web, but free plans have lower rate limits than paid plans.

## Recommended web deployment: Railway

This repository is prepared for Railway deployment.

### Railway deploy steps

1. Push this repo to GitHub.
2. In Railway, create a new project from the GitHub repo.
3. Railway will detect the included `Dockerfile` automatically.
4. Add a persistent volume mounted to `/app/data`.
5. Generate a public domain for the service.
6. Open the deployed site, click `ChatGPT 세션 시작`, and log in inside the Playwright-opened browser session.

### Recommended Railway settings

- Volume mount path: `/app/data`
- Health check path: `/api/health`
- Port: use Railway's injected `PORT`

Without a persistent volume, the ChatGPT session and cut data may be lost after restarts or redeploys.

## Vercel usage

Vercel can host the frontend shell, but not the full backend runtime for this app.

This repo now supports a split setup:

- frontend on Vercel
- backend on Railway or another server

To point the Vercel frontend at a backend:

1. Edit `public/runtime-config.js` and set `apiBaseUrl`
2. or open the site with `?apiBase=https://your-backend.example.com`

Example:

```text
https://your-vercel-site.vercel.app/?apiBase=https://your-railway-backend.up.railway.app
```

## Local run

```powershell
cd C:\path\to\prompt-bridge
npm install
npm run install:browsers
npm start
```

Open:

- [http://localhost:4310](http://localhost:4310)

## Docker run

```powershell
docker build -t prompt-bridge .
docker run -p 4310:4310 -v ${PWD}\data:/app/data prompt-bridge
```

Mounting `/app/data` is recommended so your ChatGPT session and cut data are not lost when the container restarts.

## Environment variables

- `PORT`
  - default: `4310`
- `SESSION_DIR_NAME`
  - default: `chatgpt-session`

## GitHub upload checklist

1. Create a new GitHub repository.
2. Upload this folder as the repository root.
3. Do not commit `node_modules`, runtime logs, or live session data.
4. If deploying with Docker, use the included `Dockerfile`.
5. If deploying on a server, make sure Chromium / Playwright can run.

## Notes

- The app relies on ChatGPT web UI structure, so selector changes on ChatGPT may require maintenance.
- Login is done in the Playwright-opened browser session, not by collecting ChatGPT email/password inside this app.
- Runtime cut data, uploads, and session files are stored under `data/`.
