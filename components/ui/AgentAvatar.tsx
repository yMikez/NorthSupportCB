"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { agentPhotoUrl, type SupportAgent } from "@/lib/agents";

export interface AgentAvatarProps {
  agent: SupportAgent;
  size?: "sm" | "md";
  /** Adds the pulsing ring and the availability dot — for the chat header. */
  showStatus?: boolean;
  className?: string;
}

const SIZES = {
  sm: { box: "h-8 w-8 text-sm", px: 32 },
  md: { box: "h-10 w-10 text-[0.95rem]", px: 40 },
} as const;

/**
 * The agent's face, or their initial when there is no photo for them.
 *
 * Whether a photo exists is decided by the browser, not by a build-time check:
 * an operator can drop a file into `public/agents/` and it appears on the next
 * request, and a missing or broken file degrades to the initial instead of a
 * torn image icon.
 *
 * Goes through next/image on purpose. Source photos tend to be full-resolution
 * portraits — half a megabyte for a 40px circle — and the optimizer means the
 * browser only ever fetches a couple of KB no matter what gets dropped in.
 */
export function AgentAvatar({
  agent,
  size = "sm",
  showStatus = false,
  className,
}: AgentAvatarProps) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const { box, px } = SIZES[size];

  return (
    <span
      // Deliberately not clipping here: the status ring and the online dot sit
      // outside the circle. The photo is clipped by its own wrapper.
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        box,
        showStatus && "agent-avatar--status",
        className,
      )}
      style={
        photoFailed
          ? {
              backgroundImage: `linear-gradient(135deg, ${agent.gradient[0]}, ${agent.gradient[1]})`,
            }
          : undefined
      }
      aria-hidden="true"
    >
      {photoFailed ? (
        agent.initial
      ) : (
        <span className="h-full w-full overflow-hidden rounded-full">
          <Image
            src={agentPhotoUrl(agent)}
            alt=""
            width={px * 2}
            height={px * 2}
            // Two deliberate bits of framing, neither of them decoration:
            // the zoom pushes the generator's bottom-corner watermark further
            // outside the circular clip, and `object-[50%_42%]` frames on the
            // upper half so a non-square photo dropped in by hand crops to the
            // face rather than the chest. Check public/agents/ before changing.
            className="h-full w-full scale-[1.12] object-cover object-[50%_42%]"
            onError={() => setPhotoFailed(true)}
          />
        </span>
      )}
      {showStatus && <span className="agent-online-dot" />}
    </span>
  );
}
