#!/usr/bin/env node
/**
 * Downloads one photo per support agent into `public/agents/`.
 *
 *   node scripts/fetch-agent-photos.mjs                     # agents with no photo
 *   node scripts/fetch-agent-photos.mjs --force             # replace every photo
 *   node scripts/fetch-agent-photos.mjs --only theo --force # re-roll just one
 *   node scripts/fetch-agent-photos.mjs --source https://example.com/{gender}.jpg
 *
 * **The face has to match the name.** Each agent carries a `gender` in
 * `lib/agents.ts` and this prints it next to every download — a "Marcus" with a
 * woman's photo reads as a stock-image front, which is the exact impression a
 * support desk cannot afford. Change the roster, not this file, if a pairing
 * should differ.
 *
 * The default generator takes no parameters: it returns whatever face it drew,
 * so roughly half of them come back the wrong gender and get re-rolled. Sources
 * that *can* filter by gender exist, but the ones checked so far licence their
 * free tier for personal use only and stamp a watermark across it, which rules
 * them out for a commercial support desk. Until a properly licensed one is
 * wired up, the matching is done by eye.
 *
 * **Look at every face before you ship it** — for age as much as gender. The
 * generator draws from the full range of its training data, which includes
 * children; nobody wants a support desk fronted by a nine-year-old. Re-roll
 * whatever doesn't fit with `--only <id> --force`.
 *
 * The default source returns a **synthetic** face — a GAN output, not a
 * photograph of anyone. That is deliberate. These images are shown to customers
 * as the person handling their case, and using a real, identifiable face for
 * that misrepresents someone who never agreed to it; no stock licence covers
 * it either, since they almost all forbid uses that imply the model endorses or
 * is part of the business.
 *
 * Caveat worth knowing: a GAN can occasionally emit a face close to one in its
 * training data. If a result looks like a specific person you recognise, re-run
 * with --force to draw another.
 *
 * Two things the default source does that the UI compensates for: it stamps a
 * "StyleGAN2" watermark in a bottom corner (AgentAvatar zooms past it) and it
 * returns full-resolution portraits (next/image serves the browser a fraction
 * of that). Both are handled — but if you swap --source for tightly cropped
 * photos of your own, re-check the framing in the chat header.
 *
 * Point --source anywhere you like if you have your own licensed set; `{gender}`
 * in the URL is replaced with `male` or `female`, so a source that splits its
 * sets by path still lands the right face on the right agent.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PHOTO_DIR = join(ROOT, "public", "agents");
const ROSTER_FILE = join(ROOT, "lib", "agents.ts");

const argv = process.argv.slice(2);

function takeFlag(name, fallback = null) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const value = argv[i + 1] ?? fallback;
  argv.splice(i, 2);
  return value;
}

function takeBool(name) {
  const i = argv.indexOf(name);
  if (i === -1) return false;
  argv.splice(i, 1);
  return true;
}

const SOURCE = takeFlag(
  "--source",
  "https://thispersondoesnotexist.com/random-person.jpeg",
);
const FORCE = takeBool("--force");
const ONLY = (takeFlag("--only", "") || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

/**
 * The roster lives in TypeScript, which this script cannot import. Reading it
 * straight out of the source keeps one source of truth — adding an agent there
 * is all it takes for them to get a photo of the right person here.
 */
function readRoster() {
  const source = readFileSync(ROSTER_FILE, "utf8");
  const block = source.match(
    /SUPPORT_AGENTS[^=]*=\s*\[([\s\S]*?)\]\s*as const/,
  );
  if (!block) {
    throw new Error(`Could not find SUPPORT_AGENTS in ${ROSTER_FILE}`);
  }

  const agents = [...block[1].matchAll(/\{[^}]*\}/g)].map((entry) => {
    const id = entry[0].match(/\bid:\s*"([a-z0-9-]+)"/)?.[1];
    const gender = entry[0].match(/\bgender:\s*"(female|male)"/)?.[1];
    if (!id) return null;
    // A roster entry with no gender would otherwise get a coin-flip face.
    if (!gender) {
      throw new Error(
        `Agent "${id}" has no gender in ${ROSTER_FILE} — add gender: "female" | "male".`,
      );
    }
    return { id, gender };
  });

  const roster = agents.filter(Boolean);
  if (roster.length === 0) throw new Error("SUPPORT_AGENTS looks empty.");
  return roster;
}

/**
 * One synthetic face for an agent.
 *
 * The default generator draws from its whole distribution and takes no
 * parameters, so the gender it returns is a coin flip — which is why this
 * prints what the face has to be and leaves the check to your eyes. A
 * `--source` that splits its sets by gender gets it right unattended.
 */
async function fetchFace(gender) {
  return download(SOURCE.replaceAll("{gender}", gender));
}

const BROWSER_HEADERS = {
  // Some hosts serve a placeholder to unrecognised clients.
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "image/jpeg,image/*",
};

async function download(url) {
  // The default source returns a freshly generated face per request; the
  // cache-buster keeps a CDN from handing the whole roster the same one.
  const bust = url.includes("?") ? `&_=${Date.now()}` : `?_=${Date.now()}`;
  const res = await fetch(url + bust, {
    headers: BROWSER_HEADERS,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) {
    throw new Error(`expected an image, got "${type || "nothing"}"`);
  }

  const bytes = Buffer.from(await res.arrayBuffer());
  // A few hundred bytes means an error page dressed as an image.
  if (bytes.length < 5_000) {
    throw new Error(`suspiciously small response (${bytes.length} bytes)`);
  }
  return bytes;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const roster = readRoster();
  const knownIds = roster.map((agent) => agent.id);

  const unknown = ONLY.filter((id) => !knownIds.includes(id));
  if (unknown.length) {
    throw new Error(
      `Not in the roster: ${unknown.join(", ")}. Known ids: ${knownIds.join(", ")}`,
    );
  }
  const selected = ONLY.length
    ? roster.filter((agent) => ONLY.includes(agent.id))
    : roster;

  mkdirSync(PHOTO_DIR, { recursive: true });

  console.log(`${c.bold("Agent photos")} ${c.dim(`← ${SOURCE ?? GENERATOR}`)}`);
  console.log(
    c.dim(
      ONLY.length
        ? `${selected.length} of ${roster.length} agents selected\n`
        : `${roster.length} agents in the roster\n`,
    ),
  );

  let written = 0;
  let skipped = 0;
  let failed = 0;

  for (const { id, gender } of selected) {
    const target = join(PHOTO_DIR, `${id}.jpg`);

    if (existsSync(target) && !FORCE) {
      console.log(`  ${c.dim("skip")}  ${id}.jpg ${c.dim("(already there)")}`);
      skipped++;
      continue;
    }

    try {
      const bytes = await fetchFace(gender);
      writeFileSync(target, bytes);
      const kb = Math.round(bytes.length / 1024);
      console.log(
        `  ${c.green("ok")}    ${id}.jpg ${c.dim(`${kb} KB`)} ${c.yellow(
          `← must be ${gender}`,
        )}`,
      );
      written++;
    } catch (err) {
      console.log(`  ${c.red("fail")}  ${id}.jpg ${c.dim(`— ${err.message}`)}`);
      failed++;
    }

    // The default source generates a fresh image per request; back off a little
    // so a full roster is not a burst.
    await sleep(700);
  }

  console.log(
    `\n${written} written, ${skipped} skipped${failed ? `, ${c.red(`${failed} failed`)}` : ""}.`,
  );

  if (written) {
    console.log(
      c.yellow(
        "Open every file above. A face that is the wrong gender for the name, or\n" +
          "a child, ships straight to customers — re-roll it with --only <id> --force.",
      ),
    );
  }

  if (skipped && !FORCE) {
    console.log(c.dim("Re-run with --force to replace the existing ones."));
  }
  if (failed) {
    console.log(
      c.yellow(
        "Agents without a photo fall back to their initial — the UI still works.",
      ),
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(c.red(`\n${err.message}`));
  process.exit(1);
});
