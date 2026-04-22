"use client";

import { ReactNode, useEffect } from "react";
import { Button } from "@/components/ui/Button";

export interface AdminShellProps {
  children: ReactNode;
  brandName: string;
  onSignOut?: () => void;
}

export function AdminShell({ children, brandName, onSignOut }: AdminShellProps) {
  useEffect(() => {
    document.body.classList.add("theme-admin");
    return () => {
      document.body.classList.remove("theme-admin");
    };
  }, []);

  return (
    <div className="min-h-screen">
      <header
        className="sticky top-0 z-30 border-b border-neutral-200 bg-white"
        style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
      >
        <div className="mx-auto flex h-[60px] w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="font-serif text-xl font-medium text-primary-600">
              {brandName}
            </span>
            <span className="hidden text-sm text-neutral-400 sm:inline">|</span>
            <span className="hidden text-sm font-medium text-neutral-600 sm:inline">
              Support Dashboard
            </span>
          </div>
          {onSignOut && (
            <Button variant="ghost" size="sm" onClick={onSignOut}>
              Sign out
            </Button>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>
    </div>
  );
}
