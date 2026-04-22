import { ReactNode } from "react";

type Badge = {
  icon: ReactNode;
  label: string;
};

const LockIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="11" width="16" height="9" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

const ShieldIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3 4 6v6c0 4.5 3.2 8.4 8 9 4.8-.6 8-4.5 8-9V6l-8-3Z" />
    <path d="m9.5 12 1.8 1.8L15 10" />
  </svg>
);

const ClockIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

const DEFAULT_BADGES: Badge[] = [
  { icon: LockIcon, label: "Secure & encrypted" },
  { icon: ShieldIcon, label: "ClickBank protected" },
  { icon: ClockIcon, label: "Fast resolution" },
];

export interface TrustBadgesProps {
  badges?: Badge[];
}

export function TrustBadges({ badges = DEFAULT_BADGES }: TrustBadgesProps) {
  return (
    <ul className="flex flex-wrap items-center justify-center gap-2.5">
      {badges.map((b) => (
        <li key={b.label}>
          <span className="trust-pill">
            {b.icon}
            {b.label}
          </span>
        </li>
      ))}
    </ul>
  );
}
