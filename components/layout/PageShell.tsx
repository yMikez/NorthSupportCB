import { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface PageShellProps {
  children: ReactNode;
  brandName: string;
  tagline?: string;
  className?: string;
}

export function PageShell({
  children,
  brandName,
  tagline,
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
          <span className="font-serif text-2xl font-medium text-emerald-900">
            {brandName}
          </span>
          <span className="brand-accent" aria-hidden="true" />
          {tagline && (
            <span className="mt-2 text-xs font-medium uppercase tracking-[0.08em] text-emerald-700/60">
              {tagline}
            </span>
          )}
        </header>
        {children}
      </div>
    </div>
  );
}
