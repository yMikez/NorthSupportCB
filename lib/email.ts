/**
 * Email address handling.
 *
 * This app does not send email. The customer identifies themselves with an
 * address on the first screen, and when retention fails the confirmation screen
 * hands them a `mailto:` link with the message already written — they send it
 * from their own mail app, to the inbox in `supportEmail()`.
 *
 * That is a deliberate choice, not a missing feature. An outbound send needs a
 * provider, credentials and a verified domain, and it fails silently when any
 * of the three drifts; a `mailto:` cannot fail on our side, and the customer
 * keeps a copy in their own sent folder.
 */

/** Deliberately permissive — the mail server is the real authority. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim()) && value.trim().length <= 254;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
