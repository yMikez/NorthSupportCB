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

function sanitizeVendor(vendor: string | undefined | null): string | null {
  if (!vendor) return null;
  const slug = vendor.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return slug || null;
}

export interface KnowledgeBundle {
  common: string;
  vendor: string | null;
  vendorContent: string | null;
  combined: string;
}

export async function loadKnowledge(
  vendor: string | undefined | null,
): Promise<KnowledgeBundle> {
  const common = (await readIfExists("_common.md")) ?? "";
  const slug = sanitizeVendor(vendor);
  const vendorContent = slug ? await readIfExists(`${slug}.md`) : null;

  const parts: string[] = [];
  if (common.trim()) {
    parts.push("# General policies\n\n" + common.trim());
  }
  if (vendorContent && vendorContent.trim()) {
    parts.push(
      `# Product knowledge (${slug})\n\n` + vendorContent.trim(),
    );
  }

  return {
    common,
    vendor: slug,
    vendorContent,
    combined: parts.join("\n\n---\n\n"),
  };
}
