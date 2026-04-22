"use client";

import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";
export type ButtonTone = "light" | "dark";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  tone?: ButtonTone;
  loading?: boolean;
  fullWidth?: boolean;
}

const base =
  "inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70";

const variantClasses = (variant: ButtonVariant, tone: ButtonTone): string => {
  if (variant === "primary") return "btn-premium focus-visible:ring-offset-ink-900";
  if (variant === "danger")
    return "rounded-full bg-error text-white shadow-sm hover:bg-red-600 active:bg-red-700 disabled:bg-red-300";

  if (tone === "dark") {
    if (variant === "secondary")
      return "rounded-full bg-white/8 text-white border border-white/15 hover:bg-white/12 hover:border-white/25 active:bg-white/15";
    return "rounded-full bg-transparent text-white/70 hover:bg-white/10 hover:text-white active:bg-white/15";
  }

  if (variant === "secondary")
    return "rounded-full bg-white text-neutral-800 border border-neutral-200 hover:bg-neutral-50 active:bg-neutral-100 disabled:text-neutral-400";
  return "rounded-full bg-transparent text-neutral-700 hover:bg-neutral-100 active:bg-neutral-200 disabled:text-neutral-400";
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-[54px] px-7 text-base",
};

const Spinner = ({ size }: { size: ButtonSize }) => {
  const dim = size === "sm" ? 14 : 16;
  return (
    <svg
      width={dim}
      height={dim}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    tone = "light",
    loading = false,
    fullWidth = false,
    disabled,
    className,
    children,
    type = "button",
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        base,
        variantClasses(variant, tone),
        sizes[size],
        fullWidth && "w-full",
        loading && "opacity-70",
        className,
      )}
      {...rest}
    >
      {loading ? (
        <>
          <Spinner size={size} />
          <span className="sr-only">Loading</span>
        </>
      ) : (
        children
      )}
    </button>
  );
});
