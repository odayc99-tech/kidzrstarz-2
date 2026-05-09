# KidzRstarz TODO

## Core Features
- [x] Database schema with users, orders, storyScenes, images, previewImages tables
- [x] Server-side db.ts with all CRUD helpers
- [x] Storage helpers (S3 via storagePut/storageGet)
- [x] Stripe products configuration
- [x] Stripe webhook handler
- [x] OG meta tags middleware for share pages
- [x] Preview image generation service (Pixar-style watermarked preview)
- [x] Story generation service (LLM-based personalized story)
- [x] Scene splitter service (splits story into scenes with illustration prompts)
- [x] TTS narration service (ElevenLabs + Edge TTS fallback)
- [x] Voice cloning via ElevenLabs
- [x] Video composition service (ffmpeg-based scene stitching + BGM)
- [x] Watermark service (preview watermark + brand watermark)
- [x] Retry utility with exponential backoff
- [x] Storage namespace utility
- [x] Preview generation job
- [x] Story generation job
- [x] Image generation job
- [x] Video generation job (full pipeline)
- [x] Orders router (createOrder, getOrder, getUserOrders, createCheckoutSession, getScenes, etc.)
- [x] Main routers.ts

## Frontend Pages
- [x] Home page (landing page with hero, gallery, testimonials, FAQ, pricing)
- [x] Upload page (photo upload + child info form)
- [x] Checkout page (preview + story review + payment)
- [x] Storybook page (animated storybook player)
- [x] Dashboard page (user's orders)
- [x] GuestOrders page (guest order tracking)
- [x] SharedStorybook page (public share page)
- [x] Admin page (admin panel)
- [x] MarketingStrategy page
- [x] NotFound page

## Frontend Components
- [x] StoryPlayer component
- [x] FAQSection component
- [x] GallerySection component
- [x] TestimonialCard component
- [x] TestimonialsSection component
- [x] ProgressBar component
- [x] ErrorBoundary component

## Data Files
- [x] faqs.ts
- [x] testimonials.ts
- [x] themeBgm.ts

## Infrastructure
- [x] _core/index.ts with Stripe webhook route + OG meta tags middleware
- [x] ThemeContext
- [x] guestToken lib
- [x] imageCompression lib
- [x] App.tsx with all routes
- [x] index.css with Fredoka/Baloo 2/Inter fonts and theme
- [x] index.html with font imports

## Pending
- [x] ELEVENLABS_API_KEY secret (optional - falls back to Edge TTS)
- [x] Database migration applied (all tables created)
- [x] Fix DB migration: apply missing columns to orders table and create images/previewImages/storyScenes tables

## S3 Migration (AWS)
- [x] Store AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET, S3_REGION as secrets
- [x] Install @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner
- [x] Rewrite server/storage.ts to use AWS S3 SDK with pre-signed URLs
- [x] Audit all storagePut/storageGet call sites for manus-storage URL assumptions
- [x] Test upload flow end-to-end with real S3 bucket

## Railway Migration
- [x] Remove Manus OAuth: replace sdk.authenticateRequest with JWT-only session auth
- [x] Replace registerOAuthRoutes with Google OAuth direct or remove login entirely
- [x] Replace notifyOwner (Manus Forge) with Resend email
- [x] Replace storageProxy (manus-storage) - already done via AWS S3
- [x] Remove vite-plugin-manus-runtime from vite.config.ts
- [x] Update env.ts to remove Manus-specific vars (appId, oAuthServerUrl, ownerOpenId, forgeApiUrl, forgeApiKey)
- [x] Update llm.ts to use OpenAI-compatible env vars (OPENAI_API_KEY or FORGE_API_KEY)
- [x] Update imageGeneration.ts to use OpenAI-compatible env vars
- [x] Add ADMIN_SECRET env var for admin procedure auth
- [x] Update frontend: remove getLoginUrl/useAuth Manus OAuth references
- [x] Generate JWT_SECRET and document all Railway env vars
- [x] Write Dockerfile for Railway deployment
- [x] Write Railway deployment guide
- [x] Fix imageGeneration.ts: handle url-based originalImages by downloading to buffer before sending to OpenAI edits endpoint
- [x] Fix videoGenerationJob: set order status=completed and completedAt after video upload
- [x] Fix createCheckoutSession: pass window.location.origin from frontend so success_url has correct domain on published site
- [x] Fix llm.ts: change model from gemini-2.5-flash to gpt-4o, remove Manus-specific thinking/max_tokens params

## Bug Fixes (Session 3)
- [x] Fix checkout endless spinner after Stripe payment: webhook not updating order status, add Stripe session verification fallback endpoint
- [x] Update deployed STRIPE_WEBHOOK_SECRET to match new webhook endpoint (user must set in Settings → Secrets - new value: whsec_QTwX2R1IzE7VC7DJSCYDGQ6SMELOjlh6)
- [x] Add verifyStripeSession test coverage
- [x] Add explicit checkout UI error state when session verification fails (show retry button after timeout)

## Bug Fixes (Session 4)
- [x] Fix "video is generating" message never clears: added server-side auto-resume in getOrder — restarts stuck video/scene generation when server process was restarted (cloud run idle shutdown)
- [ ] Switch Stripe from sandbox to live production mode (update live keys in Settings → Payment)
- [x] Fix Storybook page: added video player card when videoUrl exists; fixed spinner cards to hide when hasServerVideo is true
- [x] Fix "Video Generation Failed" error on published site — installed ffmpeg-static + ffprobe-static npm packages so ffmpeg is bundled in the deployment (Cloud Run has no system ffmpeg)
- [x] Fix "Order not found or unauthorized" error on Storybook page — fixed missing guestToken in storybook links in Checkout.tsx and GuestOrders.tsx
- [x] Add loading animation to Storybook page: StorybookSkeleton component with shimmer cards, animated star burst, orbiting dots, gradient progress bar, and fade-in transition when content loads
- [x] Fix spurious "Video Generation Failed" error showing even when video completes successfully — only show error card when hasServerVideo is false
- [x] Fix slow video generation on deployed site — ffmpeg-static now imported as top-level ESM (instant resolution, no subprocess spawning or 48MB download on cold start)

## Features (Session 5)
- [x] Add download button to Storybook video player card
- [x] Add server-side video download proxy endpoint (/api/download/video/:orderId) that streams the MP4 with Content-Disposition: attachment — works for both authenticated and guest users
- [x] Secure /api/download/video/:orderId: authenticated owner, admin, or valid guestToken required; 8 vitest tests covering all access paths (guest success, owner success, admin success, unauthorized rejection, missing video)

## Bug Fixes (Session 6)
- [x] Fix download button: rewritten to use 302 redirect with ResponseContentDisposition on pre-signed S3 URL (avoids Cloud Run 60s timeout from proxying large video files)
- [x] Fix orders stuck in "generating" state in admin console: replaced in-memory isVideoGenerating() with DB-based check (paid + processing + no videoUrl/videoKey)

## Bug Fixes (Session 7)
- [x] Fix download button not showing: switch from pre-signed S3 URLs to direct public S3 URLs (bucket has public read policy) — videoUrl will never expire, hasServerVideo will always be true for completed orders
- [x] Add storagePublicUrl() helper to construct direct public S3 URL from key
- [x] Update storagePut() to store public URL instead of pre-signed URL
- [x] Update getOrder refreshUrl logic to use public URL from videoKey when available
- [x] Update videoGenerationJob to store public URL when saving videoUrl (storagePut now returns public URL automatically)
- [x] Update all other storagePut call sites to use public URLs for images (storagePut now returns public URL automatically)
- [x] Update videoDownload route to use public URL directly (no pre-signed needed)
- [x] Backfill existing completed orders in DB: update videoUrl to public S3 URL using videoKey
- [x] Fix order 30001 (Nora): video file was missing from S3 (stale videoKey) — reset order to processing so auto-resume regenerates video
- [x] Add server-side S3 existence check in getOrder: if videoKey exists but S3 object is 404/403, auto-reset order for regeneration

## Bug Fixes (Session 8 — Download Button)
- [x] Fix download button: replace <a href> approach with window.open() to avoid browser blocking the redirect-to-S3 pattern
- [x] Fix download button: the /api/download/video route redirects to a pre-signed S3 URL, but the browser follows the redirect and then S3 returns the file with Content-Disposition:attachment — this works BUT the <a download> attribute is ignored on cross-origin redirects, so the browser may open the video instead of downloading it. Switch to a tRPC mutation that returns the signed URL and use window.open() or window.location.href to trigger the download
- [x] Fix download button for shared storybook page: SharedStorybook.tsx has no download button at all — add one (uses getSharedStorybookDownloadUrl mutation + window.location.href)

## Bug Fixes (Session 9 — Video Generation Root Cause)
- [x] Fix video generation: composeFullVideo reads illustrationUrl/narrationUrl from DB which are expired pre-signed URLs — reconstruct fresh public URLs from illustrationKey/narrationKey instead
- [x] Backfill storyScenes: update illustrationUrl and narrationUrl to use public S3 URLs for all scenes that have a key stored (75 scenes fixed)
- [x] Fix ffmpeg zoompan Ken Burns filter causing 'exit null: 0KiB' failures on Cloud Run — replaced with simple scale+pad+setsar filter
- [x] Reset orders 510001 and 480001 to processing so they retry video generation with the fixed code
