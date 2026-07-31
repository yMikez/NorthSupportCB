/**
 * The support agents a customer can be assigned to.
 *
 * Which one answers is derived from the conversation id, not drawn at random:
 * the same conversation always resolves to the same person, on the client and
 * on the server, without storing anything. That matters in three places — a
 * customer who refreshes mid-chat must not find a different agent, the system
 * prompt has to name the same person the header shows, and the handover email
 * has to thank the person they actually spoke to.
 *
 * Photos are opt-in: drop `<id>.jpg` into `public/agents/` and it is used
 * automatically. Without a file, the initial-and-gradient avatar renders
 * instead — see public/agents/README.md.
 */

export interface SupportAgent {
  /** Stable slug — also the photo filename. */
  id: string;
  /** First name only: what the customer sees and what the agent signs off with. */
  name: string;
  initial: string;
  /**
   * What the name reads as, so the face matches it. Nothing in the product
   * branches on this — the customer is never told "he" or "she" — it exists
   * because a face that contradicts the name reads as fake, which is the one
   * thing a support desk cannot afford. `scripts/fetch-agent-photos.mjs` asks
   * the generator for a face of this gender.
   *
   * Names that work either way (Noor) are pinned here rather than left to the
   * generator, so a re-roll can't silently flip the desk's makeup.
   */
  gender: "female" | "male";
  /**
   * Fallback avatar colours, used when no photo file exists.
   * Kept in the blue/indigo/teal range on purpose: green reads as "online" and
   * amber/red as "something is wrong" everywhere else in this UI.
   */
  gradient: readonly [string, string];
}

export const SUPPORT_AGENTS: readonly SupportAgent[] = [
  { id: "maya", name: "Maya", initial: "M", gender: "female", gradient: ["#2563eb", "#1d4ed8"] },
  { id: "julian", name: "Julian", initial: "J", gender: "male", gradient: ["#4f46e5", "#4338ca"] },
  { id: "noor", name: "Noor", initial: "N", gender: "female", gradient: ["#0e7490", "#155e75"] },
  { id: "ravi", name: "Ravi", initial: "R", gender: "male", gradient: ["#0284c7", "#0369a1"] },
  { id: "elena", name: "Elena", initial: "E", gender: "female", gradient: ["#6d28d9", "#5b21b6"] },
  { id: "marcus", name: "Marcus", initial: "M", gender: "male", gradient: ["#1e40af", "#1e3a8a"] },
  { id: "sofia", name: "Sofia", initial: "S", gender: "female", gradient: ["#0891b2", "#0e7490"] },
  { id: "theo", name: "Theo", initial: "T", gender: "male", gradient: ["#4338ca", "#3730a3"] },
] as const;

/** The one used when there is no conversation to derive from yet. */
export const DEFAULT_AGENT = SUPPORT_AGENTS[0];

/** FNV-1a — small, dependency-free, and identical in both runtimes. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Same seed → same agent, every time, everywhere. */
export function pickAgent(seed: string | null | undefined): SupportAgent {
  const trimmed = seed?.trim();
  if (!trimmed) return DEFAULT_AGENT;
  return SUPPORT_AGENTS[hash(trimmed) % SUPPORT_AGENTS.length];
}

export function agentById(id: string | null | undefined): SupportAgent | null {
  if (!id) return null;
  return SUPPORT_AGENTS.find((agent) => agent.id === id) ?? null;
}

/** Where the optional photo for an agent would live. */
export function agentPhotoUrl(agent: SupportAgent): string {
  return `/agents/${agent.id}.jpg`;
}
