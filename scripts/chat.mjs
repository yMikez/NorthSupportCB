#!/usr/bin/env node
/**
 * Terminal chat against the running support agent.
 *
 * It hits exactly the same endpoints the customer page does, so what you see
 * here is what a customer would get — including which knowledge file was
 * loaded and whether a refund would have been triggered.
 *
 *   node scripts/chat.mjs                  # order DS12345 on localhost:3000
 *   node scripts/chat.mjs JV98765          # a JVZoo order
 *   node scripts/chat.mjs DS12345 https://your-domain.com
 *
 * Type /reset to start over, /quit to leave.
 *
 * Replay a saved scenario instead of typing — one customer message per line,
 * `#` for comments. Handy for re-running the same pressure test after editing
 * knowledge/:
 *
 *   node scripts/chat.mjs --file scripts/scenarios/1-pressao-reembolso.txt
 */

import { readFileSync } from "node:fs";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const argv = process.argv.slice(2);

function takeFlag(name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  const value = argv[i + 1] ?? null;
  argv.splice(i, value === null ? 1 : 2);
  return value;
}

// Read the scenario ourselves rather than through a pipe: PowerShell mangles
// non-ASCII characters when piping into a native command.
const SCENARIO_FILE = takeFlag("--file");
const ORDER_ID = argv[0] || "DS12345";
const BASE_URL = (argv[1] || "http://localhost:3000").replace(/\/$/, "");

const ACTION_REGEX =
  /\{\s*"action"\s*:\s*"(?:escalate_to_human|create_refund|offer_close|resolve)"[^}]*\}/;

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

async function lookup(orderId) {
  const res = await fetch(`${BASE_URL}/api/lookup-order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.found) {
    throw new Error(data.error || `lookup failed (HTTP ${res.status})`);
  }
  return data;
}

/** Streams the agent reply, printing tokens as they arrive. */
async function sendTurn(state, messages) {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversationId: state.conversationId,
      platform: state.platform,
      orderId: state.orderId,
      refundAmount: state.refundAmount,
      currency: state.currency,
      messages,
    }),
  });

  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `chat failed (HTTP ${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  let printed = 0;

  stdout.write(c.green("Maya  "));
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    acc += decoder.decode(value, { stream: true });

    // Print everything except the trailing action JSON, which is internal.
    const visible = acc.replace(ACTION_REGEX, "");
    if (visible.length > printed) {
      stdout.write(visible.slice(printed));
      printed = visible.length;
    }
  }
  stdout.write("\n");

  return acc;
}

async function triggerEscalation(state, urgent) {
  const res = await fetch(`${BASE_URL}/api/escalate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderId: state.orderId,
      platform: state.platform,
      conversationId: state.conversationId,
      urgent,
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, blocked: res.status === 409, ...data };
}

function newConversationId() {
  return `cli-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Live typing. Returns null once the user closes the input. */
async function interactivePrompt() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  return async () => {
    try {
      return (await rl.question(c.cyan("You   "))).trim();
    } catch {
      return null; // Ctrl-C / stream closed
    }
  };
}

/** Scenario file or piped input: buffer every line, then feed one at a time. */
async function scriptedPrompt() {
  let raw;
  if (SCENARIO_FILE) {
    raw = readFileSync(SCENARIO_FILE, "utf8");
  } else {
    const chunks = [];
    for await (const chunk of stdin) chunks.push(chunk);
    raw = Buffer.concat(chunks).toString("utf8");
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  let i = 0;
  return async () => {
    if (i >= lines.length) return null;
    const line = lines[i++];
    console.log(c.cyan("You   ") + line);
    return line;
  };
}

async function main() {
  console.log(c.dim(`\nConnecting to ${BASE_URL} …`));

  let order;
  try {
    order = await lookup(ORDER_ID);
  } catch (err) {
    console.error(c.red(`\n✖ ${err.message}`));
    console.error(
      c.dim(
        "\nIs the server running?  npm run start\n" +
          "With MOCK_MODE=true, try order ids DS12345 / BG12345 / JV98765.",
      ),
    );
    process.exit(1);
  }

  const state = {
    conversationId: newConversationId(),
    platform: order.platform,
    orderId: order.orderId,
    refundAmount: order.refundAmount,
    currency: order.currency,
  };

  console.log(
    c.dim("─".repeat(64)) +
      `\n  ${c.bold("Order")}      ${order.orderId}` +
      `\n  ${c.bold("Platform")}   ${order.platformLabel ?? c.dim("(handoff mode — no store connected)")}` +
      `\n  ${c.bold("Product")}    ${order.productTitle ?? "—"}` +
      `\n  ${c.bold("Customer")}   ${order.firstName ?? "—"}` +
      (order.refundAmount
        ? `\n  ${c.bold("Amount")}     ${order.refundAmount} ${order.currency}`
        : "") +
      `\n  ${c.bold("Knowledge")}  knowledge/_common.md + ${
        order.vendor ? `knowledge/${order.vendor}.md` : "all product files"
      }` +
      `\n` + c.dim("─".repeat(64)),
  );

  if (order.existingCase) {
    console.log(
      c.yellow(
        `\n⚠ This order already has an open case (${order.existingCase.status}). ` +
          `The real UI would stop here.\n`,
      ),
    );
  }

  const interactive = !SCENARIO_FILE && stdin.isTTY;
  console.log(
    c.dim(
      interactive
        ? "Type your message as the customer. /reset  /quit\n"
        : `Replaying ${SCENARIO_FILE ?? "piped input"}…\n`,
    ),
  );

  const nextLine = interactive
    ? await interactivePrompt()
    : await scriptedPrompt();

  let messages = [];
  let refunded = false;

  while (true) {
    const line = await nextLine();
    if (line === null) break; // EOF / closed
    if (!line) continue;

    if (line === "/quit" || line === "/exit") break;
    if (line === "/reset") {
      messages = [];
      refunded = false;
      state.conversationId = newConversationId();
      console.log(c.dim("\n— conversation reset —\n"));
      continue;
    }
    if (refunded) {
      console.log(
        c.dim("\n(refund already issued in this conversation — /reset to retry)\n"),
      );
      continue;
    }

    messages.push({ role: "user", content: line });

    let reply;
    try {
      reply = await sendTurn(state, messages);
    } catch (err) {
      console.error(c.red(`\n✖ ${err.message}\n`));
      messages.pop();
      continue;
    }

    messages.push({ role: "assistant", content: reply });

    const match = reply.match(ACTION_REGEX);
    if (!match) {
      console.log("");
      continue;
    }

    let action = {};
    try {
      action = JSON.parse(match[0]);
    } catch {
      /* malformed marker — show it raw below */
    }

    if (
      action.action === "escalate_to_human" ||
      action.action === "create_refund"
    ) {
      const urgent = action.urgent === true;
      console.log(
        c.red(`\n▸ ACTION: escalate_to_human${urgent ? " (URGENT)" : ""}`) +
          c.dim(`  — after ${messages.filter((m) => m.role === "user").length} customer messages`),
      );
      const result = await triggerEscalation(state, urgent);
      if (result.blocked) {
        console.log(
          c.yellow(
            `▸ BLOCKED by the server gate — only ${result.demands}/6 demands. Conversation continues.\n`,
          ),
        );
      } else {
        console.log(
          result.ok
            ? c.red(`▸ Handed to a human (ref #${result.reference ?? "—"})\n`)
            : c.red(`▸ Handover FAILED: ${result.error}\n`),
        );
        refunded = true;
      }
    } else if (action.action === "offer_close") {
      console.log(
        c.green(`\n▸ ACTION: offer_close — customer retained, no refund\n`),
      );
    } else {
      console.log(c.yellow(`\n▸ ACTION: ${match[0]}\n`));
    }
  }

  const turns = messages.filter((m) => m.role === "user").length;
  console.log(
    c.dim(
      `\n── ${turns} customer message(s) · ` +
        (refunded ? c.red("REFUNDED") : c.green("no refund")) +
        c.dim(" ──\n"),
    ),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(c.red(`\nUnexpected error: ${err.message}\n`));
  process.exit(1);
});
