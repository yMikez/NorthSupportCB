import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import {
  devDetail,
  enabledPlatformIds,
  findOrder,
  getAdapter,
  isMockMode,
  platformStatuses,
} from "@/lib/platforms";
import { supportEmail } from "@/lib/mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Health check for the platform layer. Admin-only — it reports which
 * credentials are present.
 *
 *   GET /api/diagnose                     → config + readiness of each platform
 *   GET /api/diagnose?orderId=DS12345     → also runs a live lookup
 */
export async function GET(req: Request) {
  const secret = process.env.ADMIN_SECRET;
  const cookie = cookies().get("admin_auth")?.value;
  if (!secret || cookie !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const orderId = (searchParams.get("orderId") ?? "").trim();

  const env = {
    MOCK_MODE: process.env.MOCK_MODE ?? null,
    PLATFORMS: process.env.PLATFORMS ?? "(unset → all)",
    ANTHROPIC_API_KEY: present("ANTHROPIC_API_KEY"),
    ADMIN_SECRET: present("ADMIN_SECRET"),
    DATABASE_URL: present("DATABASE_URL"),
    WEBHOOK_SHARED_SECRET: present("WEBHOOK_SHARED_SECRET"),
    PRODUCT_VENDOR_MAP: process.env.PRODUCT_VENDOR_MAP ? "set" : "(unset)",
    SUPPORT_EMAIL: process.env.SUPPORT_EMAIL?.trim() || "(unset)",
    NODE_ENV: process.env.NODE_ENV,
  };

  const platforms = platformStatuses();
  const database = await checkDatabase();
  const support = checkSupportInbox();

  const warnings: string[] = [];
  if (!isMockMode()) {
    for (const platform of platforms) {
      if (platform.enabled && !platform.ready) {
        warnings.push(
          `${platform.label} is enabled but missing: ${platform.missingEnv.join(", ")}`,
        );
      }
      if (platform.enabled) {
        for (const note of platform.notes) {
          warnings.push(`${platform.label}: ${note}`);
        }
      }
    }
    if (platforms.every((p) => !p.enabled || !p.ready)) {
      warnings.push("No platform is ready — customer lookups will all fail.");
    }
  }

  warnings.push(...support.warnings);

  const response: Record<string, unknown> = {
    env,
    enabled: enabledPlatformIds(),
    platforms,
    database,
    support,
    warnings,
  };

  if (orderId) {
    response.lookup = await probeLookup(orderId);
  }

  return NextResponse.json(response);
}

function present(name: string): string {
  return process.env[name]?.trim() ? "set" : "(missing)";
}

async function checkDatabase() {
  try {
    const [orders, pendingRefunds, conversations] = await Promise.all([
      prisma.orderRecord.count(),
      prisma.refundRequest.count({ where: { status: "pending" } }),
      prisma.conversation.count(),
    ]);
    return { ok: true, orders, pendingRefunds, conversations };
  } catch (err) {
    return { ok: false, error: devDetail(err) ?? "connection failed" };
  }
}

/**
 * The app sends no email. What matters is the address the customer is pointed
 * at: it goes into the `mailto:` on the confirmation screen, so a typo here
 * means every handover lands nowhere and nobody finds out.
 */
function checkSupportInbox() {
  const inbox = supportEmail();
  const warnings: string[] = [];

  if (!process.env.SUPPORT_EMAIL?.trim()) {
    warnings.push(
      `SUPPORT_EMAIL is unset, so handovers point customers at the default "${inbox}". Set it to the inbox a person actually reads.`,
    );
  }

  return {
    // Not a transport — nothing is sent from here.
    channel: "mailto (the customer sends from their own mail app)",
    inbox,
    warnings,
  };
}

async function probeLookup(orderId: string) {
  const perPlatform: Record<string, unknown> = {};

  for (const id of enabledPlatformIds()) {
    const adapter = getAdapter(id);
    if (!adapter) continue;
    const started = Date.now();
    try {
      const order = await adapter.getOrder(orderId);
      perPlatform[id] = {
        found: order !== null,
        ms: Date.now() - started,
        vendor: order?.vendor ?? null,
        knowledgeFileExpected: order?.vendor ? `knowledge/${order.vendor}.md` : null,
        amount: order?.amount ?? null,
      };
    } catch (err) {
      perPlatform[id] = {
        found: false,
        ms: Date.now() - started,
        error: devDetail(err),
      };
    }
  }

  const resolved = await findOrder(orderId).catch(() => null);

  return {
    orderId,
    resolvedTo: resolved
      ? { platform: resolved.order.platform, vendor: resolved.order.vendor }
      : null,
    perPlatform,
  };
}
