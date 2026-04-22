import { cn } from "@/lib/cn";

export interface TypingIndicatorProps {
  className?: string;
  label?: string;
  theme?: "light" | "dark";
}

export function TypingIndicator({
  className,
  label,
  theme = "light",
}: TypingIndicatorProps) {
  const dot =
    theme === "dark"
      ? "bg-primary-400"
      : "bg-primary-400";
  const size = theme === "dark" ? "h-[7px] w-[7px]" : "h-2 w-2";

  return (
    <div
      role="status"
      aria-label={label ?? "Maya is typing"}
      className={cn("inline-flex items-center gap-1.5", className)}
    >
      <span className={cn("typing-dot block rounded-full", size, dot)} />
      <span className={cn("typing-dot block rounded-full", size, dot)} />
      <span className={cn("typing-dot block rounded-full", size, dot)} />
    </div>
  );
}
