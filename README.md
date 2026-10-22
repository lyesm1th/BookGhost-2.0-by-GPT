# 👻 BookGhost 2.0 by GPT

Telegram bot + Telegram Mini App for a Ukrainian book community.

**Status: alpha.** The code is committed, but the application is **not deployed**.

## Included
- Telegram webhook and /start, /events, /help commands
- Mini App with event list, event registration, personal events, admin event creation
- Telegram initData signature verification and owner bootstrap
- Cloudflare Workers, D1 database migration, and GitHub Actions deployment workflow

## Not implemented yet
Full event/form builders, draws, voting, tasks, anonymous questions, achievements, scheduled broadcasts, R2 uploads, and advanced admin permissions UI. Their database tables do not mean they are operational.

## Setup
1. Install Node.js 22+, run `npm install` and `npx wrangler login`.
2. Create a Cloudflare D1 database: `npx wrangler d1 create bookghost-db`.
3. Replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.toml`.
4. Apply migrations: `npm run db:remote`.
5. Set Cloudflare Worker secrets individually: `npx wrangler secret put TELEGRAM_BOT_TOKEN`, `npx wrangler secret put TELEGRAM_WEBHOOK_SECRET`, and `npx wrangler secret put OWNER_TELEGRAM_ID`.
6. Deploy with `npm run deploy`. Update `WEBAPP_URL` in `wrangler.toml` to the public HTTPS Worker URL and redeploy.
7. Configure Telegram `setWebhook` with the HTTPS `/telegram/webhook` endpoint and matching `secret_token`.
8. Send `/start` from the Telegram account specified by `OWNER_TELEGRAM_ID`.

## GitHub Actions
The workflow requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in GitHub Actions secrets, plus a valid D1 database ID in `wrangler.toml`. It cannot deploy successfully until configured.

## Security
Never commit tokens or .env/.dev.vars. The repository is public. Production capacity limits and registration concurrency still need testing.
