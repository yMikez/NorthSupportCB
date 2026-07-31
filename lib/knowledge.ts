import { promises as fs } from "node:fs";
import path from "node:path";

const KNOWLEDGE_DIR = path.join(process.cwd(), "knowledge");

const cache = new Map<string, { content: string; mtimeMs: number }>();

async function readIfExists(fileName: string): Promise<string | null> {
  const filePath = path.join(KNOWLEDGE_DIR, fileName);
  try {
    const stat = await fs.stat(filePath);
    const cached = cache.get(fileName);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.content;

    const content = await fs.readFile(filePath, "utf8");
    cache.set(fileName, { content, mtimeMs: stat.mtimeMs });
    return content;
  } catch {
    return null;
  }
}

function sanitizeSlug(value: string | undefined | null): string | null {
  if (!value) return null;
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return slug || null;
}

export interface KnowledgeBundle {
  common: string;
  vendor: string | null;
  vendorContent: string | null;
  /** Which file the vendor knowledge actually came from — useful for debugging. */
  vendorFile: string | null;
  platform: string | null;
  platformContent: string | null;
  combined: string;
}

/**
 * Builds the system knowledge for one conversation, most general first:
 *
 *   1. `_common.md`              — always loaded (tone, refund policy, closing rules)
 *   2. `_platform-<id>.md`       — optional, per-platform notes (refund windows,
 *                                  what the customer sees on their statement…)
 *   3. `<platform>-<vendor>.md`  — optional, product knowledge for one platform
 *      falling back to `<vendor>.md` — product knowledge shared across platforms
 *
 * Everything is optional except `_common.md`, so adding a product is still
 * "drop one .md file in knowledge/".
 */
export async function loadKnowledge(
  vendor: string | undefined | null,
  platform?: string | undefined | null,
): Promise<KnowledgeBundle> {
  const common = (await readIfExists("_common.md")) ?? "";
  const vendorSlug = sanitizeSlug(vendor);
  const platformSlug = sanitizeSlug(platform);

  const platformContent = platformSlug
    ? await readIfExists(`_platform-${platformSlug}.md`)
    : null;

  let vendorContent: string | null = null;
  let vendorFile: string | null = null;

  if (vendorSlug) {
    const candidates = platformSlug
      ? [`${platformSlug}-${vendorSlug}.md`, `${vendorSlug}.md`]
      : [`${vendorSlug}.md`];

    for (const candidate of candidates) {
      const content = await readIfExists(candidate);
      if (content && content.trim()) {
        vendorContent = content;
        vendorFile = candidate;
        break;
      }
    }
  } else {
    // No vendor resolved — this is the normal case in handoff mode, where we
    // never look the order up. Load every product file so the agent can still
    // answer accurately once the customer says what they bought. Prompt caching
    // makes the extra tokens cheap, and the alternative (a generic agent that
    // knows nothing about any product) is much worse.
    const bundle = await loadAllProducts();
    vendorContent = bundle.content;
    vendorFile = bundle.files.join(", ") || null;
  }

  const parts: string[] = [];
  if (common.trim()) {
    parts.push("# General policies\n\n" + common.trim());
  }
  if (platformContent && platformContent.trim()) {
    parts.push(
      `# Platform notes (${platformSlug})\n\n` + platformContent.trim(),
    );
  }
  if (vendorContent && vendorContent.trim()) {
    parts.push(
      vendorSlug
        ? `# Product knowledge (${vendorSlug})\n\n${vendorContent.trim()}`
        : "# Product knowledge — all products\n\n" +
          "The order was not matched to a specific product. Ask the customer " +
          "which one they bought, then use only that product's section below. " +
          "Never mix facts between products.\n\n" +
          vendorContent.trim(),
    );
  }

  return {
    common,
    vendor: vendorSlug,
    vendorContent,
    vendorFile,
    platform: platformSlug,
    platformContent,
    combined: parts.join("\n\n---\n\n"),
  };
}

/** Concatenates every product file, each under its own heading. */
async function loadAllProducts(): Promise<{ content: string; files: string[] }> {
  let files: string[];
  try {
    files = (await fs.readdir(KNOWLEDGE_DIR))
      .filter((file) => file.endsWith(".md"))
      .filter(
        (file) => !file.startsWith("_") && file.toLowerCase() !== "readme.md",
      )
      .sort();
  } catch {
    return { content: "", files: [] };
  }

  const sections: string[] = [];
  const used: string[] = [];

  for (const file of files) {
    const content = await readIfExists(file);
    if (!content || !content.trim()) continue;
    sections.push(`## Product: ${file.slice(0, -3)}\n\n${content.trim()}`);
    used.push(file);
  }

  return { content: sections.join("\n\n---\n\n"), files: used };
}

/**
 * Vendor slugs that actually have a knowledge file — this is what the admin
 * filter offers, instead of a hand-maintained env list.
 */
export async function listKnowledgeVendors(): Promise<string[]> {
  try {
    const files = await fs.readdir(KNOWLEDGE_DIR);
    return files
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.slice(0, -3))
      .filter((name) => !name.startsWith("_") && name.toLowerCase() !== "readme")
      .map((name) => {
        const dash = name.indexOf("-");
        // `digistore24-burnthermo.md` still means the vendor "burnthermo".
        return dash === -1 ? name : name.slice(dash + 1);
      })
      .filter((name, index, all) => all.indexOf(name) === index)
      .sort();
  } catch {
    return [];
  }
}
