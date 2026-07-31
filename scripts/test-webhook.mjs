#!/usr/bin/env node
/**
 * Sends a fake sale notification to your own webhook endpoint, so you can prove
 * the mirror works before touching the real platform dashboards.
 *
 *   node scripts/test-webhook.mjs jvzoo
 *   node scripts/test-webhook.mjs buygoods
 *   node scripts/test-webhook.mjs digistore24 --order MY-123
 *   node scripts/test-webhook.mjs jvzoo --url https://your-domain.com
 *
 * JVZoo payloads are signed with JVZOO_SECRET_KEY using the real JVZIPN
 * algorithm; BuyGoods and Digistore24 use WEBHOOK_SHARED_SECRET as a token.
 * Both are read from .env.local.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);

function takeFlag(name, fallback = null) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const value = argv[i + 1] ?? fallback;
  argv.splice(i, 2);
  return value;
}

const BASE_URL = (takeFlag("--url", "http://localhost:3000")).replace(/\/$/, "");
const ORDER_ID = takeFlag("--order", `TEST-${Date.now()}`);
const PLATFORM = (argv[0] || "jvzoo").toLowerCase();

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

/** Minimal .env.local reader — avoids adding a dotenv dependency. */
function readEnvLocal() {
  const env = {};
  try {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  } catch {
    console.error(c.red("Could not read .env.local"));
    process.exit(1);
  }
  return env;
}

/** The documented JVZIPN algorithm — same one lib/platforms/jvzoo.ts verifies. */
function signJvzoo(params, secret) {
  const keys = Object.keys(params)
    .filter((k) => k !== "cverify")
    .sort();
  const payload = [...keys.map((k) => params[k]), secret].join("|");
  return createHash("sha1").update(payload, "utf8").digest("hex").slice(0, 8).toUpperCase();
}

function buildJvzoo(env) {
  const secret = env.JVZOO_SECRET_KEY;
  if (!secret) {
    console.error(c.red("JVZOO_SECRET_KEY is empty in .env.local"));
    process.exit(1);
  }

  const params = {
    ccustname: "Ana Silva",
    ccustemail: "ana@example.com",
    ctransaction: "SALE",
    ctransreceipt: ORDER_ID,
    ctransamount: "4999", // cents, per JVZoo docs
    cproditem: "99812",
    cprodtitle: "Thermo Burn - 6 bottle bundle",
    ctranstime: String(Math.floor(Date.now() / 1000)),
    ccurrency: "USD",
  };
  params.cverify = signJvzoo(params, secret);

  return {
    url: `${BASE_URL}/api/webhooks/jvzoo`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  };
}

function buildTokenPlatform(env, platform) {
  const token = env.WEBHOOK_SHARED_SECRET;
  if (!token) {
    console.error(c.red("WEBHOOK_SHARED_SECRET is empty in .env.local"));
    console.error(c.dim("Generate one:  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""));
    process.exit(1);
  }

  const payload =
    platform === "buygoods"
      ? {
          order_id: ORDER_ID,
          email: "bruno@example.com",
          first_name: "Bruno",
          last_name: "Costa",
          product_name: "Glyco Pulse - 3 bottle bundle",
          product_id: "bg-glyco-3",
          amount: "59.99",
          currency: "USD",
          order_date: new Date().toISOString(),
          status: "completed",
        }
      : {
          purchase_id: ORDER_ID,
          email: "clara@example.com",
          first_name: "Clara",
          last_name: "Mendes",
          product_name: "Max Vitaliz - 6 bottle bundle",
          product_id: "534210",
          amount: "69.99",
          currency: "USD",
          created_at: new Date().toISOString(),
          billing_status: "completed",
        };

  return {
    url: `${BASE_URL}/api/webhooks/${platform}?token=${encodeURIComponent(token)}`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

async function main() {
  if (!["jvzoo", "buygoods", "digistore24"].includes(PLATFORM)) {
    console.error(c.red(`Unknown platform "${PLATFORM}" — use jvzoo, buygoods or digistore24.`));
    process.exit(1);
  }

  const env = readEnvLocal();
  const req =
    PLATFORM === "jvzoo" ? buildJvzoo(env) : buildTokenPlatform(env, PLATFORM);

  console.log(c.dim(`\nPOST ${req.url.replace(/token=[^&]+/, "token=***")}`));
  console.log(c.dim(`order id: ${ORDER_ID}\n`));

  let res;
  try {
    res = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body });
  } catch (err) {
    console.error(c.red(`✖ Could not reach the server: ${err.message}`));
    console.error(c.dim("Is it running?  npm run start"));
    process.exit(1);
  }

  const text = await res.text();
  console.log(`${res.ok ? c.green("✔") : c.red("✖")} HTTP ${res.status} — ${text}\n`);

  if (!res.ok) {
    if (res.status === 401) {
      console.error(
        c.dim(
          PLATFORM === "jvzoo"
            ? "Signature rejected — JVZOO_SECRET_KEY here must match the one the server loaded."
            : "Token rejected — WEBHOOK_SHARED_SECRET here must match the server's.",
        ),
      );
    }
    if (res.status === 500) {
      console.error(c.dim("Storage error — is the database up?  docker start supportchat-db"));
    }
    process.exit(1);
  }

  // Prove the round trip: the order should now resolve through the normal lookup.
  console.log(c.dim("Verifying the order is now findable…"));
  const lookup = await fetch(`${BASE_URL}/api/lookup-order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId: ORDER_ID }),
  });
  const data = await lookup.json().catch(() => ({}));

  if (lookup.ok && data.found) {
    console.log(
      c.green(`✔ Mirror works — ${ORDER_ID} resolves on ${data.platformLabel}`) +
        c.dim(`\n  customer: ${data.firstName ?? "—"}`) +
        c.dim(`\n  product:  ${data.productTitle ?? "—"}`) +
        c.dim(`\n  vendor:   ${data.vendor ?? c.red("(unmapped — set PRODUCT_VENDOR_MAP)")}`) +
        c.dim(`\n  amount:   ${data.refundAmount} ${data.currency}\n`),
    );
  } else {
    console.log(
      c.red(`✖ Stored, but the lookup could not find it: ${data.error ?? lookup.status}`) +
        c.dim("\n  With MOCK_MODE=true the mock adapter answers instead of the mirror — set MOCK_MODE=false.\n"),
    );
  }
}

main().catch((err) => {
  console.error(c.red(`\nUnexpected error: ${err.message}\n`));
  process.exit(1);
});
