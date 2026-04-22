import { cn } from "@/lib/cn";

export type StepState = "complete" | "active" | "upcoming";

export interface StepperStep {
  label: string;
  state: StepState;
}

export interface StepperProps {
  steps: StepperStep[];
  className?: string;
  theme?: "light" | "dark";
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <polyline points="5 12 10 17 19 7" />
    </svg>
  );
}

export function Stepper({ steps, className, theme = "light" }: StepperProps) {
  const isDark = theme === "dark";

  return (
    <ol
      className={cn("flex items-center justify-between gap-2", className)}
      aria-label="Support progress"
    >
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;

        const circleLight =
          step.state === "complete"
            ? "bg-primary-500 text-white"
            : step.state === "active"
              ? "bg-primary-500 text-white ring-4 ring-primary-100"
              : "bg-neutral-100 text-neutral-400 border border-neutral-200";

        const circleDark =
          step.state === "complete"
            ? "step-circle-complete"
            : step.state === "active"
              ? "step-circle-active"
              : "step-circle-upcoming";

        const circleClass = isDark ? circleDark : circleLight;

        const lineLight =
          step.state === "complete" ? "bg-primary-300" : "bg-neutral-200";
        const lineDark =
          step.state === "complete"
            ? "step-line-dark-complete"
            : "step-line-dark";

        const labelLight =
          step.state === "upcoming"
            ? "text-neutral-400"
            : "text-neutral-800 font-medium";
        const labelDark =
          step.state === "upcoming"
            ? "text-white/45"
            : step.state === "active"
              ? "text-white font-medium"
              : "text-white/70";

        return (
          <li
            key={step.label}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2",
              isLast && "flex-none",
            )}
          >
            <div className="flex flex-col items-center gap-1.5">
              <span
                aria-current={step.state === "active" ? "step" : undefined}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold transition-all duration-300",
                  circleClass,
                )}
              >
                {step.state === "complete" ? <CheckIcon /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-center text-xs",
                  isDark ? labelDark : labelLight,
                )}
              >
                {step.label}
              </span>
            </div>
            {!isLast && (
              <span
                className={cn(
                  "mb-6 h-[2px] flex-1 rounded-full transition-colors duration-300",
                  isDark ? lineDark : lineLight,
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
