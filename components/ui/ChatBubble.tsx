import { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { TypingIndicator } from "./TypingIndicator";

export type ChatBubbleRole = "user" | "assistant";

export interface ChatBubbleProps {
  role: ChatBubbleRole;
  children?: ReactNode;
  timestamp?: string;
  agentInitial?: string;
  typing?: boolean;
  className?: string;
  theme?: "light" | "dark";
}

function Avatar({
  initial = "M",
  theme = "light",
}: {
  initial?: string;
  theme?: "light" | "dark";
}) {
  if (theme === "dark") {
    return (
      <div
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-600 text-sm font-semibold text-white"
      >
        {initial}
      </div>
    );
  }
  return (
    <div
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-500 text-sm font-semibold text-white shadow-sm"
    >
      {initial}
    </div>
  );
}

export function ChatBubble({
  role,
  children,
  timestamp,
  agentInitial = "M",
  typing = false,
  className,
  theme = "light",
}: ChatBubbleProps) {
  const isUser = role === "user";
  const isDark = theme === "dark";

  return (
    <div
      className={cn(
        "flex w-full animate-bubble-in gap-2",
        isUser ? "justify-end" : "justify-start",
        className,
      )}
    >
      {!isUser && <Avatar initial={agentInitial} theme={theme} />}
      <div
        className={cn(
          "flex max-w-[80%] flex-col",
          isUser ? "items-end" : "items-start",
        )}
      >
        <div
          className={cn(
            "text-sm",
            isDark
              ? isUser
                ? "bubble-user-dark"
                : "bubble-assistant-dark"
              : isUser
                ? "bubble-user"
                : "bubble-assistant",
          )}
        >
          {typing ? <TypingIndicator theme={theme} /> : children}
        </div>
        {timestamp && (
          <span
            className={cn(
              "mt-1 text-xs",
              isDark ? "text-white/40" : "text-neutral-400",
            )}
          >
            {timestamp}
          </span>
        )}
      </div>
    </div>
  );
}
