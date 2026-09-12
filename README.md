# Kadr

Open-source video brief tool for the Cursor hackathon.

**This repository is the only product tree.** Client and Convex live here.
Render and GitHub Actions deploy from this `main`. Do not keep a second
copy of `src/` or `convex/` in another repo, and do not copy files back
and forth.

The backend is the Convex project `kadr-ai`.

Planning, BMAD, UX, and probes stay in the private repo
`hackaton-research`. That repo mounts this one at `apps/web` as a git
submodule. Product commits belong here.

## Layout

```
src/        Vite + React client
convex/     Convex schema and functions (queries, mutations, actions)
```

One repo, one `convex/` folder at the root. That is what the Convex CLI,
codegen, and deploy expect.

Secrets (`XAI_API_KEY`, fal, Google OAuth, deploy keys) stay in the Convex
dashboard and CI secrets. They are never committed.

## Local

```bash
npm install
npm run dev
```

`npm run dev` runs `convex dev` against the existing cloud project and starts
Vite. The CLI writes `.env.local` with `CONVEX_DEPLOYMENT` and `VITE_CONVEX_URL`.

Local `npm run dev` stays on the `brave-koala-766` cloud dev deployment.

Do not point this checkout at the old Convex project `kadr`
(`adorable-spaniel-605`). That deployment is leftover from the discarded
fork in `hackaton-research`.

## Production

Push to `main` deploys Convex functions via GitHub Actions
(`CONVEX_DEPLOY_KEY` repository secret). The static UI host is Render
(Netlify as backup). Set `VITE_CONVEX_URL` on the UI host to the prod
deployment:

`https://vivid-mockingbird-632.eu-west-1.convex.cloud`

UI: https://kadr-vci5.onrender.com

Google OAuth redirect:

`https://<kadr-ai-prod>.convex.site/api/auth/callback/google`
