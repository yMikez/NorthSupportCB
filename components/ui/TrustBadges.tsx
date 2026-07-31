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

const PeopleIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
    <path d="M16 5.5a3 3 0 0 1 0 5.6M17.5 14.2a5 5 0 0 1 3 4.6" />
  </svg>
);

const ClockIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

// Reassurance about the support experience itself — speed, a person at the end
// of it, privacy — rather than generic checkout badges.
const DEFAULT_BADGES: Badge[] = [
  { icon: ClockIcon, label: "Replies in minutes" },
  { icon: PeopleIcon, label: "Real people on standby" },
  { icon: LockIcon, label: "Private & encrypted" },
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
