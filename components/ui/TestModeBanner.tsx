"use client";

export function TestModeBanner() {
  if (process.env.NEXT_PUBLIC_MOCK_MODE !== "true") return null;

  return (
    <div className="relative z-20 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-900">
      <span className="inline-flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-full bg-warning"
        />
        Test mode — no real ClickBank or Anthropic calls are being made.
        <span className="hidden sm:inline text-amber-800/80">
          Try receipts like <code className="font-mono">ABC123</code>,{" "}
          <code className="font-mono">OPEN123</code>, or{" "}
          <code className="font-mono">INVALID1</code>.
        </span>
      </span>
    </div>
  );
}
