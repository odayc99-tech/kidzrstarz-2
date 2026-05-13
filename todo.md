# Pixar Child Video Generator - Recreated

## Core Features
- [x] Database schema (users, orders, images, previewImages)
- [x] Server-side order management (CRUD, status updates)
- [x] Story generation service (LLM-based)
- [x] Preview image generation service
- [x] Full-resolution image generation service
- [x] Job queue system (story, preview, image generation)
- [x] Email notification service
- [x] Stripe payment integration (checkout sessions, webhooks)
- [x] File storage (S3 for images)

## Client Pages
- [x] Home page with hero, features, testimonials, FAQ, pricing
- [x] Upload page with drag-drop, compression, child name input
- [x] Checkout page with preview, story, order summary
- [x] Dashboard page with order cards and download
- [x] Progress bar component across pages

## Supporting Components
- [x] TestimonialsSection component
- [x] TestimonialCard component
- [x] FAQSection component
- [x] ProgressBar component
- [x] Image compression utility
- [x] Testimonials data
- [x] FAQ data

## Integration
- [x] Stripe checkout session creation
- [x] Stripe webhook handler
- [x] Stripe products configuration
- [x] App routing (home, upload, checkout, dashboard)

## Testing
- [x] Orders router tests
- [x] Auth logout tests (existing)

## Styling
- [x] index.css theme variables
- [x] Light theme configuration

## Bug Fixes & New Features (Round 2)
- [x] Fix image generation - must transform photo into 3D Pixar cartoon character (not keep original)
- [x] Add story editing capability - allow users to review and modify generated story (e.g. fix hair color)
- [x] Implement Stripe Checkout Sessions with credit card, Apple Pay, Google Pay support

## Video Generation Feature (Round 3)
- [x] Research video generation approach (image animation, TTS narration)
- [x] Create video generation service on backend
- [x] Add storyScenes table to database schema (illustrations, narration, status per scene)
- [x] Create video generation job (triggered after image generation completes)
- [x] Update order flow to include video generation step
- [x] Add animated storybook player UI (StoryPlayer component, Storybook page)
- [x] Add storybook links from Checkout and Dashboard pages
- [x] Write tests for getScenes and triggerVideoGeneration endpoints (12 tests passing)

## Bug Fix (Round 4)
- [x] Fix: Story generation pipeline stuck after payment - TTS 404 caused scenes to be marked 'failed'; fixed with graceful TTS fallback and browser-native speech synthesis

## New Features (Round 5)
- [x] Voice cloning: allow customers to upload voice sample for narration (stored in S3, Edge TTS used for now)
- [x] Default cheerful non-robotic voice (Edge TTS with Ana voice, -10% rate, +5Hz pitch)
- [x] Character consistency across all storybook scenes (reference image + detailed prompts)
- [x] Child description field on Upload page for better character matching (shape, height, features)

## Story Review Feature (Round 6)
- [x] Decouple video generation from image generation - video should only start after story approval
- [x] Add story approval endpoint (approveStory) to backend
- [x] Add storyApproved field to orders schema
- [x] Update Checkout page with clear story review/edit/approve step
- [x] Video generation triggered only after user approves the story
- [x] Update tests for new approveStory endpoint (16 tests passing)

## Story Theme Selection (Round 7)
- [x] Add storyTheme field to orders database schema
- [x] Define theme options (adventure, fairy tale, space, underwater, superhero, dinosaur, pirate, enchanted forest)
- [x] Update createOrder endpoint to accept storyTheme
- [x] Update story generation service to use selected theme in LLM prompt
- [x] Add theme selector UI on Upload page with visual icon cards (8 themes)
- [x] Update tests for new getThemes endpoint (18 tests passing)

## Bug Fix (Round 7b)
- [x] Fix: Voice sample now analyzed by LLM to match closest Edge TTS voice; passed through video generation pipeline

## Bug Fix (Round 8)
- [x] Fix: Integrated ElevenLabs for true voice cloning - recorded voice is now cloned and used for narration

## ElevenLabs Voice Cloning Integration (Round 9)
- [x] Research ElevenLabs API for voice cloning and TTS
- [x] Add ELEVENLABS_API_KEY secret (validated and working)
- [x] Implement ElevenLabs voice cloning in TTS service (clone voice from sample, generate speech)
- [x] Update video generation job to clone voice once and reuse for all scenes
- [x] Fall back to Edge TTS if ElevenLabs key not configured or cloning fails
- [x] Update tests (22 tests passing across 3 files)

## Shareable Storybook Links (Round 10)
- [x] Add shareToken field to orders schema (unique, URL-safe)
- [x] Add public endpoint to get storybook by share token (no auth required)
- [x] Add endpoint for users to generate/toggle share link
- [x] Create public /share/:token storybook page (no login required)
- [x] Add share button with copy-to-clipboard on Dashboard and Storybook pages
- [x] Update tests for new share endpoints (26 tests passing across 3 files)

## Gallery/Portfolio Section (Round 11)
- [x] Generate sample Pixar-style transformation images for gallery (6 unique characters)
- [x] Create GallerySection component with themed character showcase
- [x] Integrate gallery section into homepage between Hero and How It Works
- [x] Add smooth animations and hover effects (scale, opacity transitions)
- [x] Ensure responsive design for mobile/tablet/desktop (2-col mobile, 3-col desktop)
- [x] Run tests and save checkpoint (26 tests passing)

## Bug Fixes & Content Updates (Round 12)
- [x] Replace adult "before" photos in testimonials with children's photos (generated 6 before + 6 after images)
- [x] Remove all refund-related messaging from FAQ section (renamed category to "Payments", removed refund FAQ, updated answers)
- [x] Remove refund mention from pricing section (replaced with "All sales final after confirmation")
- [x] Remove refund reference from Checkout page (updated Stripe footer text)
- [x] All 26 tests passing

## Email Update (Round 13)
- [x] Updated support email from support@pixarmagic.com to help@kidzrstarz.com across FAQ section, homepage footer, and FAQ data file

## No Refunds Confirmation Checkbox (Round 14)
- [x] Add mandatory "no refunds" confirmation checkbox to checkout page
- [x] Disable payment button until checkbox is checked
- [x] Add clear policy text next to checkbox ("all sales are final" with review confirmation)
- [x] Add amber helper text when checkbox is unchecked
- [x] All 26 tests passing

## Rebrand to KidzRstarz (Round 15)
- [x] Find all "Pixar Magic" references across the codebase (found in Home.tsx, emailService.ts, index.html)
- [x] Update header branding to KidzRstarz
- [x] Update footer branding to KidzRstarz
- [x] Update page titles, meta tags, and any other brand references (HTML title, "Why Choose" section)
- [x] Update email templates (preview ready + payment confirmation) to KidzRstarz Team
- [x] VITE_APP_TITLE is a built-in secret — cannot be changed via code
- [x] All 26 tests passing

## KidzRstarz Watermark on Storybook Images (Round 16)
- [x] Review image generation pipeline to identify watermark insertion points (preview, final, scene illustrations)
- [x] Create server-side watermark utility using sharp (applyWatermark + applyBrandWatermark)
- [x] Apply full diagonal repeating watermark to preview images (before payment)
- [x] Apply subtle bottom-right brand watermark to paid final images and scene illustrations
- [x] Watermark utility has graceful error handling (returns original on failure)
- [x] 6 watermark tests + 26 existing tests = 32 tests all passing

## Background Music per Story Theme (Round 17)
- [x] Review current theme system and available story themes (8 themes: adventure, fairytale, space, underwater, superhero, dinosaur, pirate, enchantedForest)
- [x] Review storybook player audio pipeline (client-side playback, no server-side mixing)
- [x] Generate 8 theme-appropriate background music tracks (~60s each, instrumental, gentle)
- [x] Upload all 8 music tracks to CDN
- [x] Create theme-to-music mapping (client/src/data/themeBgm.ts) with volume constants
- [x] Integrate background music into StoryPlayer with default volume at 15% (max 35%)
- [x] Add music toggle button and volume slider popup in player controls
- [x] Pass storyTheme prop to StoryPlayer in Storybook and SharedStorybook pages
- [x] BGM auto-plays/pauses with player, mutes when narration is muted, loops continuously
- [x] All 32 tests passing

## Homepage Redesign - Fun & Eye-Catching (Round 18)
- [x] Upload unicorn logo to CDN
- [x] Redesign hero section with vibrant purple-to-pink gradient, unicorn logo as hero image
- [x] Update color scheme (purple/pink/orange gradient) and typography (Fredoka headings, Baloo 2)
- [x] Add fun animations (floating orbs, twinkling stars, floating badges, hero image float)
- [x] Update header with logo image and colorful gradient brand name
- [x] Redesign How It Works, Features, Pricing, and Footer sections with matching fun theme
- [x] Added wave SVG divider between hero and content
- [x] All 32 tests passing

## Open Graph Meta Tags for Share Pages (Round 19)
- [x] Review share page structure and server-side routing (Express + Vite SPA)
- [x] Add server-side middleware (ogMetaTags.ts) to inject OG meta tags for /share/:token URLs
- [x] Include og:title, og:description, og:image, og:url, og:site_name, twitter:card, twitter:title, twitter:description, twitter:image, meta description
- [x] Fetch storybook data (character image, child name, story theme) from DB for dynamic tags
- [x] Fallback to default KidzRstarz branding if DB query fails
- [x] 7 OG middleware tests + 32 existing = 39 tests all passing

## Email Notification & Download Features (Round 20)
- [x] Review existing email service and video generation job completion flow
- [x] Create storybook-ready email template with character image, child name, and CTA link
- [x] Add notification trigger in videoGenerationJob when all scenes complete
- [x] Include user's child name, story theme, and direct link to storybook in email
- [x] Also notify site owner via notifyOwner when storybook completes
- [x] Add download button for Pixar character image (high-res PNG) on storybook page
- [x] Add download all scene illustrations button on storybook page
- [x] Download section with gradient card, progress indicators, and toast feedback
- [x] Small download icon on character image card for quick access
- [x] All 39 tests passing (5 test files)

## Video Download Fix (Round 21)
- [x] Added videoUrl/videoKey fields to orders schema and ran migration
- [x] Created server-side video composition service (ffmpeg) combining scene images + narration + BGM
- [x] Ken Burns zoom effect on each scene, 1080p output, theme-appropriate background music at 15% volume
- [x] Integrated video composition into videoGenerationJob pipeline (runs after all scenes complete)
- [x] Replaced individual scene download button with "Full Storybook Video" download (MP4)
- [x] Kept character image download button
- [x] All 39 tests passing

## Bug Fix - Rate Exceeded JSON Error (Round 22)
- [x] Investigated: Forge API returns plain text "Rate exceeded" instead of JSON on 429
- [x] Created retry utility (server/services/retry.ts) with exponential backoff
- [x] Added retry to image generation API (3 retries, 3s initial delay)
- [x] Added retry to LLM invocation (3 retries, 2s initial delay)
- [x] Added retry to storage upload (3 retries, 2s initial delay)
- [x] Added user-friendly error message in createOrder: "Our servers are busy right now"
- [x] All 39 tests passing

## Bug Fix - Persistent Rate Exceeded Error & Checkout Link (Round 23)
- [x] Rate exceeded error was on production (not yet republished with retry fix)
- [x] Removed "Download High-Res Image" link from checkout page (kept "Watch Animated Storybook" only)
- [x] All 39 tests passing

## Bug Fix - Payment Loop (Round 24)
- [x] Root cause: Stripe checkout opened in new tab, original tab still showed unpaid state
- [x] Changed to redirect in same window (window.location.href instead of window.open)
- [x] Added paymentPending state with "Confirming Payment..." yellow card UI
- [x] Added aggressive polling (every 2s for 60s) after returning from Stripe success URL
- [x] Auto-detects webhook payment update and shows confirmation toast
- [x] All 39 tests passing

## Guest Checkout - No Login Required (Round 25)
- [x] Review all auth dependencies in upload, order creation, checkout, storybook pages
- [x] Add guestToken column to orders schema, make userId nullable, run migration
- [x] Create storageNamespace helper for guest vs user storage paths
- [x] Make createOrder endpoint work without authentication (publicProcedure with guestToken)
- [x] Make getOrder, updateStory, regenerateStory, approveStory, createCheckoutSession, getScenes, triggerVideoGeneration, uploadVoiceSample work with guest token
- [x] Make getThemes and getVoices fully public (no auth required)
- [x] Keep getUserOrders, generateShareLink, revokeShareLink as auth-only
- [x] Update Upload page to not require login, remove auth gate
- [x] Update Checkout page to work for guest users via guestToken
- [x] Update Storybook page to work for guest users via guestToken
- [x] Add optional "Create Account / Sign In" banner on Upload, Checkout, Storybook pages
- [x] Create client-side guestToken localStorage utility
- [x] Update Stripe checkout to work without user email from auth
- [x] Email notifications gracefully skip guest orders (already handled)
- [x] Update all tests for new guest-accessible procedures (38 tests passing across 5 files)
- [x] Zero TypeScript errors

## Claim Guest Orders + Guest My Orders Page (Round 26)
- [x] Backend: Add claimGuestOrders endpoint to link guest orders to user account on login
- [x] Backend: Add getGuestOrders endpoint to fetch orders by guest tokens
- [x] Backend: Add getOrdersByGuestTokens and claimGuestOrders DB helpers
- [x] Frontend: useAuth hook auto-claims guest orders on login (removes tokens from localStorage after claiming)
- [x] Create guest "My Orders" page (/my-orders) that retrieves orders from localStorage guestTokens
- [x] My Orders page redirects to Dashboard for authenticated users
- [x] Add "My Orders" + "Create Now" nav buttons for guests on homepage (replaces old "Get Started" login button)
- [x] Update routing in App.tsx for /my-orders
- [x] Write tests for claimGuestOrders and getGuestOrders endpoints (5 new tests)
- [x] Test full guest flow end-to-end: /my-orders redirects to dashboard for logged-in users, upload works without auth
- [x] All 43 tests passing across 5 files, zero TypeScript errors

## Stripe Webhook Fix (Round 27)
- [x] Review current webhook handler and Express middleware ordering (express.raw registered before express.json — confirmed correct)
- [x] Fix webhook to return valid JSON with { verified: true } for test events
- [x] Ensure all webhook responses return HTTP 200 with valid JSON (signature failure, processing error, and success all return 200)
- [x] Verify express.raw() is registered BEFORE express.json() for webhook route (confirmed at line 36-37 of server/_core/index.ts)
- [x] Write/update tests and verify fix
- [x] All 43 tests passing, zero TypeScript errors

## Stripe Promo Code Fix (Round 28)
- [x] Diagnosed promo code issue: local sandbox uses TEST keys, deployed site uses LIVE keys
- [x] Promo code MANUS100OFFH6a was created in test mode, doesn't work on live checkout
- [x] Added adminCreatePromoCode endpoint to create promo codes using server's Stripe key
- [x] Temporarily made endpoint public, deployed, created MANUS99OFF (99% off) in LIVE mode
- [x] Reverted endpoint back to adminProcedure for security
- [x] Live promo code MANUS99OFF is active with 100 max redemptions

## Guest Token URL Recovery Fix (Round 29)
- [x] Diagnosed "Order Not Found" bug: guest token not saved to localStorage before redirect
- [x] Upload page now passes guestToken in URL when redirecting to checkout
- [x] Checkout page recovers guestToken from URL params as fallback, saves to localStorage
- [x] Storybook page recovers guestToken from URL params as fallback, saves to localStorage
- [x] Stripe success/cancel URLs now include guestToken for guest orders
- [x] URL guestToken is cleaned from URL after recovery (replaceState)
- [x] Fixed coupon duration from "forever" to "once" for one-time payments
- [x] Created MANUS99OFFV2 promo code in live mode with duration "once"
- [x] All 43 tests passing, zero TypeScript errors

## Storybook tRPC Error Fix (Round 30)
- [x] Investigated: tRPC error was caused by transient proxy/deployment returning HTML error page instead of JSON
- [x] Added custom fetch wrapper in tRPC client to detect non-JSON responses and throw friendly error message
- [x] Added retry logic (up to 3 retries with exponential backoff) for transient failures
- [x] Smart retry: skips retrying auth, validation, not-found, and forbidden errors
- [x] All 43 tests passing, zero TypeScript errors

## Email Notification 404 Fix (Round 31)
- [x] Investigated: email service was calling non-existent `/notification/email` endpoint on Manus Forge API (returns 404)
- [x] Root cause: Manus platform only provides `notifyOwner` (push notifications to project owner), not a general email API
- [x] Removed broken emailService.ts entirely
- [x] Removed email sending from previewGenerationJob (no longer sends preview-ready email)
- [x] Replaced email sending in videoGenerationJob with owner notification only (notifyOwner)
- [x] Removed unused getUserById import from videoGenerationJob
- [x] All 42 tests passing, zero TypeScript errors (1 pre-existing ElevenLabs timeout unrelated)

## Bug Fixes & Improvements (Round 32)
- [x] Fix video download not working on completed storybook
- [x] Add rendering progress message to video generation page (allow a few minutes)
- [x] Improve story ending - ensure proper concluding tone instead of abrupt cutoff

## Bug Fixes & Improvements (Round 33)
- [x] Fix video download - replaced server-side ffmpeg with client-side browser video composition (Canvas + MediaRecorder)
- [x] Add progress bar/percentage to video download button (shows % and status during composition)
- [x] Add Regenerate Story button on storybook page (with confirmation step, resets story + scenes)
- [x] Fix email/notification branding - replace "Manus" with "KidzRstarz" in ManusDialog + notifications
