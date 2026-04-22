"use client";

import { InputHTMLAttributes, forwardRef, useId } from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  rounded?: "md" | "full";
  theme?: "light" | "dark";
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, rounded = "md", theme = "light", id, className, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? `input-${autoId}`;
  const errorId = error ? `${inputId}-error` : undefined;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const isDark = theme === "dark";

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={inputId}
          className={cn(
            "mb-1.5 block text-sm font-medium",
            isDark ? "text-white/65" : "text-neutral-800",
          )}
        >
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId ?? hintId}
        className={cn(
          "w-full transition-all duration-200 ease-out",
          isDark
            ? "input-dark"
            : cn(
                "bg-white text-base text-neutral-900 placeholder:text-neutral-400",
                "border-[1.5px] px-4 py-2.5 focus:outline-none",
                rounded === "full" ? "rounded-full" : "rounded-md",
                error
                  ? "border-error focus:border-error focus:ring-2 focus:ring-red-100"
                  : "border-neutral-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-100",
                "disabled:bg-neutral-50 disabled:text-neutral-400",
              ),
          isDark && error && "!border-error",
          className,
        )}
        {...rest}
      />
      {error ? (
        <p
          id={errorId}
          className={cn(
            "mt-1.5 text-sm",
            isDark ? "text-red-400" : "text-error",
          )}
        >
          {error}
        </p>
      ) : hint ? (
        <p
          id={hintId}
          className={cn(
            "mt-1.5 text-xs",
            isDark ? "text-white/40" : "text-neutral-400",
          )}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
});
