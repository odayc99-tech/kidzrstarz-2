# Theme manager and soundtrack selection — staging

This enhancement extends the existing Railway app; it does not replace hosting, migrate MySQL, change Stripe/provider credentials, lower the price, or change the working recorded-voice and MP4-download paths. Production/main must not be updated by this staging release.

## Owner workflow

Use the existing admin login at `/admin-login`, then open `/admin/themes` (also linked from `/admin`). The initial catalog preserves the eight existing theme settings and tones. Create a draft theme with a stable ID, display title/description, private setting/tone, category, icon/color, default music, and sort/featured settings. Save and publish it to offer it to new stories; hide it instead of deleting it. Saved order settings do not change when a catalog definition is edited or hidden. Draft revisions are pinned so background refreshes cannot silently overwrite another editor's work.

The catalog uses private S3 JSON at `config/experience/themes-v1.json` with conditional writes. New orders save immutable experience JSON beside their server-generated original-image key before database insertion or background jobs. Only a confirmed missing object seeds legacy/default behavior; access, bucket, timeout, corruption and revision-conflict errors are not treated as absence. No database migration is needed. Public APIs return only display metadata, not private generation prompts.

## Music status

The user approved three original instrumental tracks on November 2, 2026: Playful Adventure, Magical Wonder and Cozy Bedtime. Each is bundled as a versioned 60-second stereo MP3, with a smooth circular crossfade and consistent approximately -16 LUFS loudness. All three presets are available to the chooser, user-started audition, player and MP4 composer at:

- `client/public/audio/kidzrstarz/playful-adventure-v1.mp3`
- `client/public/audio/kidzrstarz/magical-wonder-v1.mp3`
- `client/public/audio/kidzrstarz/cozy-bedtime-v1.mp3`

Production builds copy these assets to `dist/public`. Review source/distribution rights before commercial production. Retain earlier versions because an order saves the selected version permanently. No music is generated per story. Explicit `none` is distinct from omitting a default. The player starts audio only after the viewer presses Play and has separate music controls/status. Watching volume/mute does not edit the downloaded video. MP4 music mixing uses low gain, fades and narration ducking; a saved-track failure cannot silently become silence or another track. Legacy orders keep their previous mapping and fallback.

## Validation and next user test

Offline mocked tests cover owner authorization, public prompt omission, conditional conflicts, hidden selections before uploads, snapshot preservation, explicit no music, trusted paths, private errors, narration/video integration and player states. A local synthetic-media test verifies real FFmpeg selected/no-music MP4 output, H.264 4:2:0/AAC, valid duration and full decoding with cloud storage/network mocked. The frontend/server build passes; the full project retains its pre-existing `Window.Clerk` TypeScript diagnostic.

After staging deployment, the owner should add/publish a seasonal draft, check the upload choices, and hide it again while confirming an already-created story remains unchanged. Audition the three tracks on the creation page, choose one or No music, then test the player and download for a new sandbox story. Existing stories retain their earlier frozen or legacy soundtrack; this release does not retrofit them. Use Stripe test cards only; image/speech usage on a sandbox order can still use real provider credits. No live admin write, customer story, payment, voice or AI generation is performed by the release verification.

## Original soundtrack provenance

The three instrumentals were generated once through Manus music generation with distinct original prompts, no vocals, no artist/song references and no customer recordings. The generated source files remain in the private task workspace; only prepared MP3 assets are included in the repository. They are not represented as exclusive copyright or independently legally cleared compositions. Review applicable generation-service distribution terms before commercial production rollout. Do not replace the v1 bytes after orders freeze those paths; publish any later replacement under v2 instead.

Technical checks cover each MP3's duration, stereo codec, full decoding, non-silent loudness and true peaks, plus actual FFmpeg composition of synthetic narration/images with each real soundtrack and explicit no music. Live listening in the user account and the music-bearing customer-story download remain for the owner to confirm after deployment.
