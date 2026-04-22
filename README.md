# ClickBank Support Chat

A customer support web app for physical products sold through ClickBank. Customers enter a receipt number, chat with an AI agent, and — if appropriate — get a refund initiated automatically. A separate admin panel lets the vendor review open tickets and mark returned product receipts.

Built with Next.js 14 (App Router) + TypeScript + Tailwind CSS. No database required — all state lives in memory or is fetched live from the ClickBank REST API.

## Features

- Receipt validation and open-ticket detection
- Live refund-amount lookup from ClickBank
- AI support chat powered by Claude (`claude-sonnet-4-20250514`) with streamed responses
- Automatic refund submission when the AI confirms intent
- Password-protected admin panel with open-ticket list, "mark returned" action, and 60s auto-refresh
- Per-IP rate limit of 20 chat requests per hour
- All ClickBank/Anthropic API calls happen server-side — keys never reach the browser

## Project layout

```
/app
  /page.tsx                       customer chat page
  /admin/page.tsx                 admin panel
  /admin/login/page.tsx           admin password form
  /api/check-ticket/route.ts      wraps GET /tickets/list?receipt=
  /api/refund-amount/route.ts     wraps GET /tickets/refundAmounts/{id}
  /api/chat/route.ts              streams Claude response
  /api/create-refund/route.ts     POST /tickets/{receipt} type=rfnd
  /api/mark-returned/route.ts     POST /tickets/{id}/returned
  /api/admin/tickets/route.ts     open tickets for admin
  /api/admin/login/route.ts       admin auth
/middleware.ts                    admin auth guard
/lib/clickbank.ts                 typed ClickBank REST client
/lib/claude.ts                    Claude streaming helper
/lib/rateLimit.ts                 in-memory rate limiter
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env.local` and fill in the values:

```bash
cp .env.example .env.local
```

| Variable | What it is |
| --- | --- |
| `CLICKBANK_API_KEY_READ` | ClickBank API key with **API Order Read Role** |
| `CLICKBANK_API_KEY_WRITE` | ClickBank API key with **API Order Write Role** |
| `CLICKBANK_VENDOR_ACCOUNT` | Your ClickBank vendor nickname |
| `ANTHROPIC_API_KEY` | Claude API key from https://console.anthropic.com/ |
| `ADMIN_SECRET` | A strong random string used as the admin password |

### 3. Run in development

```bash
npm run dev
```

- Customer page: http://localhost:3000
- Admin panel: http://localhost:3000/admin (you will be redirected to `/admin/login`)

## Getting ClickBank API keys

1. Sign in to your ClickBank vendor account.
2. Go to **Account Settings** → **API keys**.
3. Create two keys:
   - One with the **API Order Read Role** (used for reading tickets and refund amounts).
   - One with the **API Order Write Role** (used for submitting refunds and marking returns).
4. Copy each key into the corresponding variable in `.env.local`.
5. Note your **vendor account nickname** (top-right of your ClickBank dashboard) and set `CLICKBANK_VENDOR_ACCOUNT`.

Reference: https://support.clickbank.com/hc/en-us/articles/220376587-ClickBank-API

## Deploy

### Vercel

1. Push this repo to GitHub.
2. Import the repo into https://vercel.com/new.
3. In the Vercel project, open **Settings → Environment Variables** and add all five variables from `.env.example`.
4. Deploy. Your app will be served at `https://<project>.vercel.app` with HTTPS by default.

### Railway

1. Push this repo to GitHub.
2. Create a new project at https://railway.app/new and choose **Deploy from GitHub repo**.
3. Under **Variables**, add all five variables from `.env.example`.
4. Railway auto-detects Next.js; build command `npm run build`, start command `npm start`.
5. Add a public domain under **Settings → Networking**. Railway issues HTTPS certs automatically.

## Security notes

- API keys are only read from server-side code (`app/api/*` and `lib/*`). They are never sent to the browser.
- The admin panel is guarded by `middleware.ts`, which checks an HTTP-only cookie signed with `ADMIN_SECRET`.
- The `/api/chat` route is rate-limited to 20 requests per IP per hour. This is in-memory and resets on deploy.
- Use a long, random `ADMIN_SECRET` in production.

## AI behaviour

The assistant's system prompt instructs it to:

1. Ask why the customer wants a refund.
2. Attempt to resolve technical/delivery issues first.
3. Confirm intent with the customer before submitting a refund.
4. Emit a JSON action object `{"action":"create_refund","receipt":"…"}` when confirmed.

The frontend parses that JSON marker, calls `POST /api/create-refund`, and shows the customer the return-instruction confirmation.
