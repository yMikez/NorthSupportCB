import { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { TypingIndicator } from "./TypingIndicator";

export type ChatBubbleRole = "user" | "assistant";

export interface ChatBubbleProps {
  role: ChatBubbleRole;
  children?: ReactNode;
  timestamp?: string;
  agentInitial?: string;
  /** Replaces the initial circle — pass an <AgentAvatar /> to show a face. */
  avatar?: ReactNode;
  typing?: boolean;
  className?: string;
  theme?: "light" | "dark";
  /** Same speaker as the bubble above — tightens the corner and hides the avatar. */
  grouped?: boolean;
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
  avatar,
  typing = false,
  className,
  theme = "light",
  grouped = false,
}: ChatBubbleProps) {
  const isUser = role === "user";
  const isDark = theme === "dark";

  return (
    <div
      className={cn(
        "flex w-full animate-bubble-in gap-2.5",
        isUser ? "justify-end" : "justify-start",
        grouped ? "mt-1" : "mt-4 first:mt-0",
        className,
      )}
    >
      {/* Keep the avatar's footprint on grouped turns so bubbles stay aligned. */}
      {!isUser &&
        (grouped ? (
          <div className="h-8 w-8 shrink-0" aria-hidden="true" />
        ) : (
          avatar ?? <Avatar initial={agentInitial} theme={theme} />
        ))}
      <div
        className={cn(
          "flex max-w-[82%] flex-col",
          isUser ? "items-end" : "items-start",
        )}
      >
        <div
          className={cn(
            "text-sm",
            grouped && "is-grouped",
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
              "mt-1 px-1 text-[11px] tabular-nums",
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
