# KidzRstarz — Code Review & Setup Report

**Date:** May 12, 2026  
**Repository:** `odayc99-tech/kidzrstarz-2`  
**Stack:** React 19 + TypeScript + Vite 7 (frontend) · Express + tRPC + Drizzle ORM (backend) · MySQL · AWS S3 · Stripe · ElevenLabs TTS · ffmpeg

---

## 1. Architecture Overview

KidzRstarz is a full-stack monorepo that transforms a child's uploaded photo into a personalised Pixar-style animated storybook. The application follows a clear three-layer architecture.

| Layer | Technology | Location |
|---|---|---|
| **Frontend** | React 19, Vite 7, TailwindCSS 4, tRPC client | `client/src/` |
| **Backend** | Express 4, tRPC server, Drizzle ORM | `server/` |
| **Shared** | Zod schemas, TypeScript types | `shared/`, `drizzle/schema.ts` |

The backend exposes a single tRPC router (`/api/trpc`) plus three REST endpoints: Stripe webhook (`/api/stripe/webhook`), video download (`/api/download/video/:orderId`), and an OAuth callback. In development, Vite runs as middleware inside the Express server so there is only one port to manage.

### User Flow

1. **Upload** — user uploads a child's photo; the image is stored in S3.
2. **Details** — user enters the child's name, theme, and optional description.
3. **Voice (optional)** — user records a voice sample; ElevenLabs clones the voice.
4. **Preview** — AI generates a low-res Pixar-style preview image; user reviews it.
5. **Checkout** — user pays $29.99 via Stripe.
6. **Generation pipeline** — after payment confirmation via Stripe webhook, the server:
   - Generates a personalised story with GPT-4.
   - Generates scene illustrations with DALL-E / Forge.
   - Generates per-scene narration audio (ElevenLabs or Edge TTS fallback).
   - Composes all scenes into an MP4 with ffmpeg.
   - Uploads the final video to S3.
7. **Storybook** — user watches the animated storybook and downloads the MP4.
8. **Share** — a shareable `/share/:token` link is available for family and friends.

---

## 2. Code Quality Findings

### 2.1 Strengths

**Graceful degradation without a database.** `server/db.ts` lazily initialises the Drizzle connection only when `DATABASE_URL` is present. Every database helper returns early with a console warning when the DB is unavailable, allowing the server to start and serve static pages even in a bare sandbox environment.

**Retry and error resilience.** `server/services/retry.ts` implements exponential back-off for S3 and generation calls. The video generation job records `errorMessage` on the order row when any step fails, making failures visible in the admin panel.

**Clean tRPC contract.** The router in `server/routers.ts` and `server/routers/orders.ts` uses Zod for all inputs. Public, protected, and admin procedures are clearly separated via middleware in `server/_core/trpc.ts`.

**Consistent storage abstraction.** `server/storage.ts` provides a thin `storagePut` / `storageGet` / `storagePublicUrl` API that hides S3 details from the rest of the codebase.

**Comprehensive test coverage.** The project includes unit and integration tests for the download flow, video composition, watermarking, S3 storage, admin login, and auth logout — all using Vitest.

### 2.2 Issues Found and Fixed

| # | File | Issue | Fix Applied |
|---|---|---|---|
| 1 | `stripe.ts` (root) | Legacy root-level file shadowed the `stripe` npm package, causing `TS1192: Module has no default export` in `server/webhooks/stripe.ts` and `server/routers/orders.ts` | Renamed to `stripe.ts.legacy` to remove the shadow |
| 2 | `tsconfig.json` | `stripe.ts` was not excluded, so TypeScript picked it up even though it was not in the `include` paths | Added `"stripe.ts"` to the `exclude` array |
| 3 | `package.json` | `resend` package was imported in `server/_core/notification.ts` but not listed as a dependency | Installed `resend@6.12.3` |
| 4 | `server/services/videoComposition.ts` | `ffprobe-static` had no type declarations, causing `TS7016` | Installed `@types/ffprobe-static@2.0.3` |

After these fixes, `pnpm check` (TypeScript strict mode) passes with **zero errors**.

### 2.3 Remaining Observations

**Root-level legacy files.** There are approximately 44 `.ts` files at the repository root (e.g., `db.ts`, `orders.ts`, `videoGenerationJob.ts`, `watermark.ts`, etc.) that appear to be early-iteration copies of the files now properly located under `server/`. They are not included in the TypeScript compilation (`tsconfig.json` only includes `client/src/**/*`, `shared/**/*`, and `server/**/*`) but they add noise and could confuse contributors. **Recommendation:** move them to a `_legacy/` directory or delete them after confirming they are not referenced anywhere.

**Admin login requires a live database.** The `auth.adminLogin` mutation creates an admin user row in the database before issuing a JWT. Without `DATABASE_URL`, the upsert silently no-ops and the subsequent `getUserByOpenId` call returns `null`, causing the session cookie to be set but the next authenticated request to fail. **Recommendation:** for local development without a DB, consider issuing the JWT based purely on the `ADMIN_SECRET` check and storing a synthetic in-memory admin user.

**Stripe still in test mode.** The `todo.md` confirms that Stripe live credentials have not been activated. The `STRIPE_SECRET_KEY` and `VITE_STRIPE_PUBLISHABLE_KEY` must be set to live keys before going to production.

**ElevenLabs voice cloning is optional.** If `ELEVENLABS_API_KEY` is absent, `ttsService.ts` falls back to `edge-tts-universal` (Microsoft Edge TTS), which provides free narration but with a less natural voice.

**OG meta tags for share pages.** `server/middleware/ogMetaTags.ts` injects Open Graph tags for `/share/:token` routes, which is good for social sharing previews.

**`pasted_file_*` artefacts.** Several files named `pasted_file_*.tsx` exist at the root. These appear to be temporary paste artefacts from a previous editing session and should be removed.

---

## 3. Environment Variables Required

The following variables must be set before the full application works. Variables marked **Required** will cause features to fail silently or throw errors if absent.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | **Yes** | MySQL connection string — all order and user data |
| `JWT_SECRET` | **Yes** | Signs session cookies |
| `ADMIN_SECRET` | **Yes** | Protects the `/admin` panel |
| `OPENAI_API_KEY` | **Yes** | Story generation (GPT-4) and image generation (DALL-E) |
| `OPENAI_BASE_URL` | **Yes** | `https://api.openai.com/v1` |
| `AWS_ACCESS_KEY_ID` | **Yes** | S3 uploads |
| `AWS_SECRET_ACCESS_KEY` | **Yes** | S3 uploads |
| `S3_BUCKET` | **Yes** | `kidzrstarz-upload` |
| `S3_REGION` | **Yes** | `us-east-2` |
| `STRIPE_SECRET_KEY` | **Yes** | Payment processing |
| `STRIPE_WEBHOOK_SECRET` | **Yes** | Stripe webhook verification |
| `VITE_STRIPE_PUBLISHABLE_KEY` | **Yes** | Stripe frontend |
| `ELEVENLABS_API_KEY` | Optional | High-quality voice cloning (falls back to Edge TTS) |
| `RESEND_API_KEY` | Optional | Owner email notifications on new orders |
| `OWNER_EMAIL` | Optional | Recipient for order notifications |

---

## 4. Local Development Setup

The dev server is now running. Steps performed:

```bash
# 1. Clone repository
gh repo clone odayc99-tech/kidzrstarz-2

# 2. Install dependencies
cd kidzrstarz-2
pnpm install
pnpm approve-builds   # approve @tailwindcss/oxide and esbuild native builds

# 3. Install missing packages
pnpm add resend @types/ffprobe-static

# 4. Fix TypeScript issues
#    - Renamed root stripe.ts → stripe.ts.legacy (shadowed npm package)
#    - Added stripe.ts to tsconfig.json exclude list

# 5. Create .env with dev secrets
# (JWT_SECRET, ADMIN_SECRET, OPENAI_API_KEY set; DB/S3/Stripe commented out)

# 6. Start dev server
pnpm dev
# → Server running on http://localhost:3000/
```

---

## 5. Deployment (Railway)

The repository includes a `Dockerfile` and `RAILWAY_DEPLOYMENT.md` with full Railway deployment instructions. Key steps:

1. Create a Railway project with a MySQL service.
2. Add a web service pointing to this repository.
3. Set all required environment variables (see Section 3).
4. Run `pnpm drizzle-kit push` to apply database migrations.
5. Configure the Stripe webhook endpoint to `https://<your-domain>/api/stripe/webhook`.

The Dockerfile installs `ffmpeg` system-wide, which is required for video composition.

---

## 6. Pre-Live Checklist (from `todo.md`)

The following items remain before the site is ready for live payments:

- [ ] Complete a full sandbox end-to-end validation: upload → checkout → S3 storage → video generation → storybook access → video download.
- [ ] Switch Stripe from test mode to live mode after end-to-end validation passes.
- [ ] Persist story-generation failures on orders and show a retry path instead of leaving checkout on an endless loading state.
- [ ] Resolve browser-level sandbox generation blockers (OpenAI story and preview generation must be confirmed working with live keys).
