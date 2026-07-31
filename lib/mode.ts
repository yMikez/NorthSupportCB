/**
 * Operating mode for the support flow.
 *
 * `handoff` (the default) is the "no store integration yet" mode:
 *   - the customer just types their order number; we do not query any platform
 *   - the agent works retention as hard as the policy allows
 *   - when it cannot retain, the conversation is escalated to a human instead
 *     of issuing a refund — nothing is ever refunded automatically
 *
 * `api` is the fully-wired mode: orders are resolved through the platform
 * adapters and approved refunds are issued (or queued) automatically.
 *
 * Switching is one env var — the platform layer stays in place either way.
 */
export type SupportMode = "handoff" | "api";

export function supportMode(): SupportMode {
  return process.env.SUPPORT_MODE === "api" ? "api" : "handoff";
}

export function isHandoffMode(): boolean {
  return supportMode() === "handoff";
}

/**
 * Where a human picks the conversation up. Shown to the customer when the
 * agent escalates, so they know the request did not vanish.
 */
export function supportEmail(): string {
  return process.env.SUPPORT_EMAIL?.trim() || "suporte@northsupplements.online";
}
