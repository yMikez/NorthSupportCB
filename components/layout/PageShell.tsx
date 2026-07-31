import { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface PageShellProps {
  children: ReactNode;
  brandName: string;
  tagline?: string;
  /** Availability line under the brand — omit to hide the pill entirely. */
  status?: string;
  className?: string;
}

const HeadsetIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
    <path d="M4 14h2a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4Z" />
    <path d="M20 14h-2a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-4Z" />
    <path d="M19 19v.5a2.5 2.5 0 0 1-2.5 2.5H13" />
  </svg>
);

export function PageShell({
  children,
  brandName,
  tagline,
  status,
  className,
}: PageShellProps) {
  return (
    <div className="relative flex min-h-screen w-full items-start justify-center overflow-hidden px-4 py-10 sm:items-center sm:py-16">
      <div
        className="mesh-blob mesh-blob--tr animate-blob-drift-1"
        aria-hidden="true"
      />
      <div
        className="mesh-blob mesh-blob--bl animate-blob-drift-2"
        aria-hidden="true"
      />
      <div className="dot-grid" aria-hidden="true" />

      <div
        className={cn(
          "relative z-10 w-full max-w-[560px] space-y-6",
          className,
        )}
      >
        <header className="flex flex-col items-center gap-1 text-center animate-fade-up-soft delay-100">
          <span className="brand-mark mb-3" aria-hidden="true">
            {HeadsetIcon}
          </span>
          <span className="font-serif text-2xl font-medium text-primary-900">
            {brandName}
          </span>
          <span className="brand-accent" aria-hidden="true" />
          {tagline && (
            <span className="mt-2 text-xs font-medium uppercase tracking-[0.08em] text-neutral-500">
              {tagline}
            </span>
          )}
          {status && (
            <span className="status-pill mt-3">
              <span className="status-pill__dot" aria-hidden="true" />
              {status}
            </span>
          )}
        </header>
        {children}
      </div>
    </div>
  );
}
