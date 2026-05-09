# KidzRstarz — Railway Deployment Guide

This guide walks you through deploying KidzRstarz to Railway from start to finish. All Manus-specific infrastructure (OAuth, Forge API, storage proxy, analytics) has been replaced with standard, self-hosted equivalents.

---

## Architecture Overview

| Component | Technology |
|---|---|
| Web server | Node.js 22 + Express + tRPC |
| Frontend | React 19 + Vite (built to `dist/public`, served by Express) |
| Database | Railway MySQL 8 |
| File storage | AWS S3 (`kidzrstarz-upload`, `us-east-2`) |
| AI / LLM | OpenAI API (`gpt-4o`, `dall-e-3`, `whisper-1`) |
| Voice TTS | ElevenLabs API (optional; falls back to Edge TTS) |
| Notifications | Resend email API |
| Video composition | ffmpeg (installed via Dockerfile) |
| Auth | Guest token flow (no login required for customers) |
| Admin access | `ADMIN_SECRET` header guard |

---

## Step 1 — Create a Railway Project

1. Go to [railway.app](https://railway.app) and open your existing project (or create a new one).
2. Add a **MySQL** database service from the Railway template catalogue.
3. Add a **Web Service** and connect it to your GitHub repository (or use the Railway CLI to deploy from local files).

---

## Step 2 — Add a Dockerfile

Create a `Dockerfile` at the root of the project:

```dockerfile
FROM node:22-slim

# Install system dependencies: ffmpeg (for video composition) + xz-utils (for archive extraction)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    xz-utils \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build frontend
RUN pnpm build

# Expose port (Railway injects PORT automatically)
EXPOSE 3000

CMD ["node", "dist/server.js"]
```

> **Note:** The `ffmpeg` system package resolves the video composition issue that exists on Manus/Cloud Run. Railway runs a persistent container, so `ffmpeg` is available for the lifetime of the deployment.

---

## Step 3 — Add a Build Script

Ensure `package.json` has a `build` script that compiles both the server and the frontend:

```json
"scripts": {
  "build": "vite build && tsc -p tsconfig.server.json --outDir dist",
  "start": "node dist/server.js",
  "dev": "NODE_ENV=development tsx watch server/_core/index.ts"
}
```

If a `tsconfig.server.json` does not exist, create one:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "module": "CommonJS",
    "noEmit": false
  },
  "include": ["server/**/*", "shared/**/*", "drizzle/**/*"]
}
```

---

## Step 4 — Set Environment Variables

In your Railway web service, go to **Variables** and add every variable in the table below. Variables marked **Required** will cause the app to crash if missing.

| Variable | Required | Description | Where to get it |
|---|---|---|---|
| `DATABASE_URL` | ✅ | MySQL connection string | Railway → MySQL service → **Connect** tab → `DATABASE_URL` |
| `JWT_SECRET` | ✅ | Signs session cookies | Use the value below (or generate your own with `openssl rand -hex 32`) |
| `ADMIN_SECRET` | ✅ | Protects admin panel routes | Choose any strong random string |
| `OPENAI_API_KEY` | ✅ | LLM, image generation, Whisper | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `OPENAI_BASE_URL` | ✅ | OpenAI API base URL | `https://api.openai.com/v1` |
| `AWS_ACCESS_KEY_ID` | ✅ | S3 uploads | AWS IAM → your key |
| `AWS_SECRET_ACCESS_KEY` | ✅ | S3 uploads | AWS IAM → your key |
| `S3_BUCKET` | ✅ | S3 bucket name | `kidzrstarz-upload` |
| `S3_REGION` | ✅ | S3 region | `us-east-2` |
| `STRIPE_SECRET_KEY` | ✅ | Stripe payments | [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys) |
| `STRIPE_WEBHOOK_SECRET` | ✅ | Stripe webhook verification | Stripe → Webhooks → your endpoint → signing secret |
| `VITE_STRIPE_PUBLISHABLE_KEY` | ✅ | Stripe frontend key | [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys) |
| `ELEVENLABS_API_KEY` | Optional | Voice cloning (falls back to Edge TTS if absent) | [elevenlabs.io](https://elevenlabs.io) |
| `RESEND_API_KEY` | Optional | Owner email notifications on new orders | [resend.com](https://resend.com) |
| `OWNER_EMAIL` | Optional | Email address to receive notifications | Your email address |

### Generated JWT_SECRET (use this or replace with your own)

```
6a61aac69581f0e80d1656e04e38bb7d267c3edc80cebedc05676ed4660640cb
```

---

## Step 5 — Configure Stripe Webhook

1. In the [Stripe Dashboard](https://dashboard.stripe.com/webhooks), click **Add endpoint**.
2. Set the endpoint URL to: `https://your-railway-domain.railway.app/api/stripe/webhook`
3. Select these events to listen for:
   - `checkout.session.completed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
4. Copy the **Signing secret** and set it as `STRIPE_WEBHOOK_SECRET` in Railway.

---

## Step 6 — Configure Resend (Optional, for order notifications)

1. Create a free account at [resend.com](https://resend.com).
2. Add and verify your sending domain (e.g. `kidzrstarz.com`). Until verified, Resend will only send to your own email address.
3. Generate an API key and set it as `RESEND_API_KEY` in Railway.
4. Set `OWNER_EMAIL` to the address that should receive new-order notifications.
5. Update the `from` address in `server/_core/notification.ts` to match your verified domain.

---

## Step 7 — Run Database Migrations

After the first deploy, run the Drizzle migrations to create all tables:

```bash
# From your local machine with DATABASE_URL set to the Railway MySQL URL:
pnpm drizzle-kit push
```

Alternatively, connect to Railway's MySQL service directly and run the SQL files in `drizzle/` in order (`0000_*.sql` → `0001_*.sql` → etc.).

---

## Step 8 — Deploy

Push to your connected GitHub branch (or use `railway up` from the CLI). Railway will:

1. Build the Docker image (installs ffmpeg automatically).
2. Run `pnpm build` to compile the frontend and server.
3. Start the app with `node dist/server.js`.

---

## Admin Panel Access

The admin panel at `/admin` is protected by the `ADMIN_SECRET` env var. To log in, navigate to `/admin` and enter the value you set for `ADMIN_SECRET`.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Video generation fails | ffmpeg not found | Ensure the Dockerfile installs `ffmpeg` |
| Upload returns 500 | S3 credentials wrong | Check `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_REGION` |
| Stripe webhook returns 400 | Wrong signing secret | Re-copy `STRIPE_WEBHOOK_SECRET` from Stripe Dashboard |
| Images not loading | S3 bucket policy | Ensure the IAM user has `s3:GetObject` and `s3:PutObject` on the bucket |
| Admin panel inaccessible | Wrong `ADMIN_SECRET` | Check the value in Railway Variables |
| Notifications not sent | Resend domain not verified | Verify your domain in Resend dashboard, or use `onboarding@resend.dev` for testing |
