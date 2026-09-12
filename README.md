# Kadr

Open-source video brief tool for the Cursor hackathon. The public source of
truth is this repository. The backend is the Convex project `kadr-ai`.

## Layout

```
src/        Vite + React client
convex/     Convex schema and functions (queries, mutations, actions)
```

One repo, one `convex/` folder at the root. That is what the Convex CLI,
codegen, and deploy expect. Do not split the client and Convex into two
repositories.

Secrets (`XAI_API_KEY`, fal, Google OAuth, deploy keys) stay in the Convex
dashboard and CI secrets. They are never committed.

## Local

```bash
npm install
npm run dev
```

`npm run dev` runs `convex dev` against the existing cloud project and starts
Vite. The CLI writes `.env.local` with `CONVEX_DEPLOYMENT` and `VITE_CONVEX_URL`.

## Production

Push to `main` deploys Convex functions via GitHub Actions
(`CONVEX_DEPLOY_KEY` repository secret). The static UI host is Render
(Netlify as backup). Set `VITE_CONVEX_URL` on the UI host to the prod
deployment:

`https://vivid-mockingbird-632.eu-west-1.convex.cloud`

UI: https://kadr-vci5.onrender.com

Google OAuth redirect:

`https://<kadr-ai-prod>.convex.site/api/auth/callback/google`

Local `npm run dev` stays on the `brave-koala-766` cloud dev deployment.
