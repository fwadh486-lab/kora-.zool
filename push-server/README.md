# Kora Zol — Background Web Push

Chrome's Push API wakes the installed PWA service worker even when the page is closed. This Worker stores device subscriptions privately in D1 and sends a delayed test notification, as well as notifications for goals, kickoff and full time for followed teams or starred fixtures.

## Test locally

```sh
cd push-server
npm ci
npm test
npm run check
```

Tests exercise the notification handler without any open browser window, event transitions, per-device authorization, the delayed test, actual Web Push encryption, a simulated football feed, and unsubscribe. The FCM response and live fixtures are simulated in tests; physical-phone delivery must be tested on a deployed Worker.

## Deploy a new Worker

1. Sign in to a Cloudflare account. Use Node 22+ and `npx --yes wrangler@4.165.0 login`.
2. In this directory run `npm ci`, then `npx --yes wrangler@4.165.0 d1 create korazol-push`. Copy the example config to `wrangler.jsonc` and replace the database ID with the returned ID. The actual config is ignored by Git.
3. Run `npx --yes wrangler@4.165.0 d1 execute korazol-push --remote --file schema.sql`, then `npm run deploy`.
4. The Worker uses an existing VAPID secret keypair when present. Otherwise, it creates one stable keypair on its first request or scheduled run and retains it in the private D1 database. Do not switch key sources or rotate the keys after devices subscribe. For a brand-new deployment with no subscribers, `npm run setup-keys -- --create-new-keypair` can provision Cloudflare secrets instead.
5. For real match alerts, set a valid API-Football key with `npx --yes wrangler@4.165.0 secret put API_FOOTBALL_KEY`. Never put this key or the VAPID private key into browser code. Test notifications work without the football API key.
6. Put the returned HTTPS Worker origin in the repository-root `push-config.json` under `endpoint`. Publish the feature branch to GitHub Pages only after the endpoint is deployed and configured.

The cron runs once a minute. API-Football requests are shared across subscribers and skipped if nobody follows a team or match. A valid plan allowing at least 1,440 requests per day (more around UTC midnight) is necessary for continuous goal alerts. The 100-request free tier is not enough. Check live endpoint access and provider terms before enabling it. Cloudflare free capacity may suit a small test; monitor CPU and D1 limits before public launch.

## Phone verification

The dashboard-only deployment can paste the bundled `dashboard-worker.mjs` into the Worker code editor, bind the existing D1 database as `DB`, and configure a one-minute cron trigger (`* * * * *`). Public app defaults are included; signing keys are generated in private D1 without exposing secret values.

Open Kora Zol in Chrome or from the icon on Android. Go to Settings → Phone notifications, enable background push, allow Chrome's notification permission, tap Send test, close Kora Zol, and wait a minute or two. Verify that Android shows the notification in the system tray and tapping it opens the app. Do not force-stop Chrome; the operating system may delay or block pushes when notification permissions or background activity are restricted.

Then follow a team or star a match, enable the required event types, and confirm real-match notifications during a live fixture. No subscription endpoint, private key or user preference is written to the public Git repository. The Worker never exposes those stored records.
