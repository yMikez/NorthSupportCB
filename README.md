# Multi-Platform Support Chat

A customer support web app for physical products sold through **BuyGoods**,
**Digistore24** and **JVZoo**. Customers enter their order number, chat with an
AI agent whose first job is to *retain* them, and — only when that fails — get a
refund started automatically. A separate admin panel shows every conversation
and the queue of refunds that still need a human.

Built with Next.js 14 (App Router) + TypeScript + Tailwind + Prisma/Postgres.

## How it works

```
customer types an order number
        │
        ▼
POST /api/lookup-order ──► asks all enabled platforms in parallel,
        │                  keeps the first hit (auto-detection)
        ▼
POST /api/chat ─────────► knowledge/_common.md + knowledge/<vendor>.md
        │                  become Claude's system prompt
        ▼
agent emits {"action":"create_refund","order":"…"}
        │
        ▼
POST /api/create-refund ─► platform API if available,
                           otherwise the /admin refund queue
```

## Platform support

| Platform | Order lookup | Refunds | What you need |
| --- | --- | --- | --- |
| **Digistore24** | REST API (`getPurchase`) | API, once verified | `DIGISTORE24_API_KEY` |
| **BuyGoods** | Webhook mirror (REST optional) | Admin queue by default | Postback URL configured |
| **JVZoo** | JVZIPN webhook mirror | Admin queue (no refund API exists) | `JVZOO_SECRET_KEY` |

**A refund is never lost.** When a platform can't issue it programmatically —
JVZoo always, the others when the API is off or fails — the request is written
to the refund queue in `/admin`, and the customer sees the same confirmation
either way. See [lib/refunds.ts](lib/refunds.ts).

### About the webhook mirror

JVZoo has no endpoint to look a transaction up after the sale, only JVZIPN
notifications. So sales are mirrored into an `OrderRecord` table as they happen,
and lookups read from there. Consequence: **orders placed before the webhook was
configured cannot be found.** Set the webhooks up first.

## Project layout

```
/app
  /page.tsx                        customer chat page
  /admin/page.tsx                  conversations + refund queue
  /api/lookup-order/route.ts       auto-detects the platform for an order id
  /api/chat/route.ts               streams the Claude response
  /api/create-refund/route.ts      platform refund, or queue it
  /api/resolve-conversation/       marks a conversation as retained
  /api/webhooks/[platform]/        sale notifications from each platform
  /api/diagnose/route.ts           admin-only health check
  /api/admin/…                     conversations, refund queue, login
/lib/platforms/
  types.ts                         Order / SupportTicket / PlatformAdapter
  registry.ts                      enabled platforms + parallel auto-detection
  digistore24.ts buygoods.ts jvzoo.ts
  orderStore.ts                    webhook mirror (OrderRecord)
  vendorMap.ts                     product id → knowledge file
/lib/refunds.ts                    refund with automatic fallback to the queue
/lib/knowledge.ts                  builds the system prompt from knowledge/
/lib/claude.ts                     Claude streaming helper
/knowledge/                        the agent's brain — see knowledge/README.md
```

Nothing outside `lib/platforms/` knows which platforms exist. Adding a fourth
one means writing one adapter and registering it in `registry.ts`.

## Setup

### 1. Install and generate the Prisma client

```bash
npm install
npx prisma generate
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Fill in at least `ANTHROPIC_API_KEY`, `ADMIN_SECRET` and `DATABASE_URL`. Every
variable is documented inline in [.env.example](.env.example).

### 3. Migrate the database

```bash
npm run db:migrate
```

### 4. Run

```bash
npm run dev
```

- Customer page: http://localhost:3000
- Admin panel: http://localhost:3000/admin

### Trying it without any credentials

Set `MOCK_MODE=true` and `NEXT_PUBLIC_MOCK_MODE=true`. The whole flow works with
fake data:

| Order number | What happens |
| --- | --- |
| `DS12345` | resolves on Digistore24 |
| `BG12345` | resolves on BuyGoods |
| `JV12345` | resolves on JVZoo |
| `DS12345OPEN` | simulates an already-handled refund |
| `DSINVALID` | simulates "order not found" |

## Testing the agent's behaviour

`MOCK_MODE` fakes the *orders*; `MOCK_AI` fakes the *agent*. To tune the
retention policy you want fake orders and a real agent:

```env
MOCK_MODE=true      # no platform credentials needed
MOCK_AI=false       # real Claude — reads knowledge/ for real
ANTHROPIC_API_KEY=sk-ant-...
```

Then talk to it from the terminal, which hits the same endpoints as the
customer page:

```bash
npm run start
node scripts/chat.mjs                 # interactive
node scripts/chat.mjs --file scripts/scenarios/1-pressao-reembolso.txt
```

The header shows which knowledge files were loaded, and every refund/close
action the agent emits is printed, so you can see exactly when it caved.

Scenarios in [scripts/scenarios/](scripts/scenarios/) cover the four cases that
matter: refund pressure (must resist), chargeback threat (must refund at once),
adverse reaction (must refund at once), and a customer who never mentions a
refund (the agent must not bring it up).

## Connecting the platforms

### Digistore24
1. Account → Settings → API, generate a key → `DIGISTORE24_API_KEY`.
2. Confirm in their docs whether your account can refund via API. Only then set
   `DIGISTORE24_ENABLE_API_REFUND=true`; until then refunds queue in `/admin`.
3. Optionally point the IPN at
   `https://<domain>/api/webhooks/digistore24?token=<WEBHOOK_SHARED_SECRET>` as
   a safety net if their API is down.

### JVZoo
1. Product → JVZIPN URL: `https://<domain>/api/webhooks/jvzoo`.
2. Copy that product's JVZIPN secret key into `JVZOO_SECRET_KEY`.
3. Refunds always go to the admin queue — JVZoo has no refund API.

### BuyGoods
1. Point the sale postback at
   `https://<domain>/api/webhooks/buygoods?token=<WEBHOOK_SHARED_SECRET>`.
2. If your account manager provides REST credentials, set `BUYGOODS_API_BASE`
   and `BUYGOODS_API_KEY`, then finish `fetchOrderFromApi` in
   [lib/platforms/buygoods.ts](lib/platforms/buygoods.ts).

### Verify
Log into `/admin`, then open `/api/diagnose`. It reports which platforms are
enabled, which credentials are missing, and warns about anything that would make
lookups fail. `/api/diagnose?orderId=XYZ` runs a live lookup against each one.

## Teaching the agent about your products

Drop a `.md` file in [knowledge/](knowledge/) and map your product id to it in
`PRODUCT_VENDOR_MAP`. Full instructions: [knowledge/README.md](knowledge/README.md).

## Deploy

See [docs/DEPLOY.md](docs/DEPLOY.md) for the Docker Compose + Caddy setup. The
`knowledge/` folder is mounted as a volume, so editing a `.md` on the server
takes effect on the next conversation without a rebuild.

## Security notes

- All platform and Anthropic keys are read server-side only; they never reach
  the browser.
- The admin panel is guarded by [middleware.ts](middleware.ts) (HTTP-only cookie
  checked against `ADMIN_SECRET`). `/api/admin/*` and `/api/diagnose` re-check
  it independently.
- `/api/chat` is limited to 20 requests per IP per hour; `/api/lookup-order` to
  30, which also blunts order-number guessing. Both are in-memory and reset on
  deploy.
- JVZoo webhooks are verified with the documented JVZIPN SHA1 signature.
  BuyGoods and Digistore24 webhooks use `WEBHOOK_SHARED_SECRET`, compared in
  constant time.

## AI behaviour

The agent's whole personality lives in [knowledge/_common.md](knowledge/_common.md),
not in code. It is instructed to:

1. Silently triage the customer's mood (angry / disappointed / calm).
2. De-escalate and refund fast when hostile — a chargeback costs more than a refund.
3. Otherwise work the retention playbook: reframe the timeline, suggest a dosage
   adjustment, ask about lifestyle factors, small-commitment close.
4. Emit `{"action":"create_refund","order":"…"}` only after explicit confirmation.
5. Emit `{"action":"offer_close","order":"…"}` when the customer is satisfied,
   which renders a "Close support ticket" button.
