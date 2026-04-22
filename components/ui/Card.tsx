import { HTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "elevated" | "bordered" | "subtle" | "glass";
  hoverable?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
}

const paddings = {
  none: "",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

const variants = {
  elevated: "bg-white shadow-md rounded-xl",
  bordered: "bg-white border border-neutral-100 rounded-xl",
  subtle: "bg-neutral-50 border border-neutral-100 rounded-xl",
  glass: "glass-card",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  {
    variant = "elevated",
    hoverable = false,
    padding = "md",
    className,
    children,
    ...rest
  },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "transition-all duration-200 ease-out",
        variants[variant],
        paddings[padding],
        hoverable && "hover:-translate-y-px hover:shadow-lg",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});
