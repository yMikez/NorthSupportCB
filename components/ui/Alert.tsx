"use client";

import { ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/cn";

export type AlertVariant = "success" | "error" | "info" | "warning";

export interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children?: ReactNode;
  autoDismissMs?: number;
  onDismiss?: () => void;
  className?: string;
}

const styles: Record<
  AlertVariant,
  { accent: string; bg: string; text: string; iconColor: string; icon: ReactNode }
> = {
  success: {
    accent: "border-l-primary-500",
    bg: "bg-primary-50",
    text: "text-primary-900",
    iconColor: "text-primary-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.12" />
        <path
          d="m8.5 12 2.5 2.5L15.5 9"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  error: {
    accent: "border-l-error",
    bg: "bg-red-50",
    text: "text-red-900",
    iconColor: "text-error",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.12" />
        <path
          d="M12 8v5m0 3h.01"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  info: {
    accent: "border-l-info",
    bg: "bg-blue-50",
    text: "text-blue-900",
    iconColor: "text-info",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.12" />
        <path
          d="M12 11v5m0-8.5h.01"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  warning: {
    accent: "border-l-warning",
    bg: "bg-amber-50",
    text: "text-amber-900",
    iconColor: "text-warning",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
        <path
          d="M12 3 2 20h20L12 3Z"
          fill="currentColor"
          opacity="0.12"
        />
        <path
          d="M12 10v4m0 3h.01"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
};

export function Alert({
  variant = "info",
  title,
  children,
  autoDismissMs,
  onDismiss,
  className,
}: AlertProps) {
  const [visible, setVisible] = useState(true);
  const s = styles[variant];

  useEffect(() => {
    if (!autoDismissMs) return;
    const t = setTimeout(() => {
      setVisible(false);
      onDismiss?.();
    }, autoDismissMs);
    return () => clearTimeout(t);
  }, [autoDismissMs, onDismiss]);

  if (!visible) return null;

  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-lg border-l-[3px] px-4 py-3 text-sm animate-toast-in transition-opacity",
        s.bg,
        s.text,
        s.accent,
        className,
      )}
    >
      <span className={cn("mt-0.5", s.iconColor)}>{s.icon}</span>
      <div className="flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && "mt-0.5")}>{children}</div>}
      </div>
    </div>
  );
}
