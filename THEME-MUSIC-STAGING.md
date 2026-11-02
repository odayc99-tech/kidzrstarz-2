# Theme manager and soundtrack selection — staging

This enhancement extends the existing Railway app; it does not replace hosting, migrate MySQL, change Stripe/provider credentials, lower the price, or change the working recorded-voice and MP4-download paths. Production/main must not be updated by this staging release.

## Owner workflow

Use the existing admin login at `/admin-login`, then open `/admin/themes` (also linked from `/admin`). The initial catalog preserves the eight existing theme settings and tones. Create a draft theme with a stable ID, display title/description, private setting/tone, category, icon/color, default music, and sort/featured settings. Save and publish it to offer it to new stories; hide it instead of deleting it. Saved order settings do not change when a catalog definition is edited or hidden. Draft revisions are pinned so background refreshes cannot silently overwrite another editor's work.

The catalog uses private S3 JSON at `config/experience/themes-v1.json` with conditional writes. New orders save immutable experience JSON beside their server-generated original-image key before database insertion or background jobs. Only a confirmed missing object seeds legacy/default behavior; access, bucket, timeout, corruption and revision-conflict errors are not treated as absence. No database migration is needed. Public APIs return only display metadata, not private generation prompts.

## Music status

Three controlled, versioned presets are wired into the chooser, player and MP4 composer: Playful Adventure, Magical Wonder and Cozy Bedtime. Their source is awaiting the user's separate choice, so presets are deliberately unavailable and no audio files are included in this release. Do not claim music auditions or rendered soundtracks have passed a live test yet. Do not turn on availability before the approved files exist at all of:

- `client/public/audio/kidzrstarz/playful-adventure-v1.mp3`
- `client/public/audio/kidzrstarz/magical-wonder-v1.mp3`
- `client/public/audio/kidzrstarz/cozy-bedtime-v1.mp3`

Production builds copy these assets to `dist/public`. Review source/distribution rights before commercial production. Retain earlier versions because an order saves the selected version permanently. No music is generated per story. Explicit `none` is distinct from omitting a default. The player starts audio only after the viewer presses Play and has separate music controls/status. Watching volume/mute does not edit the downloaded video. MP4 music mixing uses low gain, fades and narration ducking; a saved-track failure cannot silently become silence or another track. Legacy orders keep their previous mapping and fallback.

## Validation and next user test

Offline mocked tests cover owner authorization, public prompt omission, conditional conflicts, hidden selections before uploads, snapshot preservation, explicit no music, trusted paths, private errors, narration/video integration and player states. A local synthetic-media test verifies real FFmpeg selected/no-music MP4 output, H.264 4:2:0/AAC, valid duration and full decoding with cloud storage/network mocked. The frontend/server build passes; the full project retains its pre-existing `Window.Clerk` TypeScript diagnostic.

After staging deployment, the owner should add/publish a seasonal draft, check the upload choices, and hide it again while confirming an already-created story remains unchanged. After approved tracks are supplied and enabled, test audition/selection/playback and a new sandbox story/MP4. Use Stripe test cards only; image/speech usage on a sandbox order can still use real provider credits. No live admin write, customer story, payment, voice or AI generation is performed by the release verification.
