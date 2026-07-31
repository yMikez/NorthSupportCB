import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Trust blue — the support-desk convention (Zendesk/Intercom/Freshdesk).
        // The ramp is shifted one step darker than Tailwind's stock blue so that
        // every existing `primary-500` surface clears 4.5:1 against white text.
        primary: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#2563eb",
          600: "#1d4ed8",
          700: "#1e40af",
          800: "#1e3a8a",
          900: "#172554",
          950: "#0f1c3f",
        },
        // Slate rather than stone: a cool grey keeps the neutrals in the same
        // temperature family as the blue instead of fighting it.
        neutral: {
          50: "#f8fafc",
          100: "#f1f5f9",
          200: "#e2e8f0",
          300: "#cbd5e1",
          400: "#94a3b8",
          500: "#64748b",
          600: "#475569",
          700: "#334155",
          800: "#1e293b",
          900: "#0f172a",
        },
        ink: {
          900: "#0f172a",
          950: "#020617",
        },
        // Amber stays reserved for "needs attention" so it reads as a signal,
        // never as decoration.
        success: "#059669",
        warning: "#d97706",
        error: "#dc2626",
        info: "#0284c7",
      },
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        serif: [
          "var(--font-lora)",
          "ui-serif",
          "Georgia",
          "Cambria",
          "Times New Roman",
          "serif",
        ],
      },
      fontSize: {
        xs: ["0.75rem", { lineHeight: "1.5" }],
        sm: ["0.875rem", { lineHeight: "1.6" }],
        base: ["1rem", { lineHeight: "1.6" }],
        lg: ["1.125rem", { lineHeight: "1.6" }],
        xl: ["1.25rem", { lineHeight: "1.4" }],
        "2xl": ["1.5rem", { lineHeight: "1.3" }],
        "3xl": ["1.875rem", { lineHeight: "1.3" }],
      },
      borderRadius: {
        sm: "6px",
        md: "12px",
        lg: "16px",
        xl: "24px",
        "2xl": "28px",
        full: "9999px",
      },
      boxShadow: {
        sm: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
        md: "0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)",
        lg: "0 8px 24px rgba(0,0,0,0.10), 0 4px 8px rgba(0,0,0,0.04)",
        ring: "0 0 0 4px rgba(37, 99, 235, 0.12)",
        glass:
          "0 0 0 1px rgba(37,99,235,0.15), 0 32px 64px rgba(0,0,0,0.4), inset 0 0 80px rgba(37,99,235,0.06)",
        "glow-sm": "0 0 16px rgba(37,99,235,0.45)",
        "glow-md": "0 4px 24px rgba(37,99,235,0.35), inset 0 1px 0 rgba(255,255,255,0.1)",
        "glow-lg": "0 8px 32px rgba(37,99,235,0.45)",
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-up-soft": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-up-card": {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "blob-drift-1": {
          "0%, 100%": { transform: "translate3d(0, 0, 0) scale(1)" },
          "50%": { transform: "translate3d(-40px, 30px, 0) scale(1.06)" },
        },
        "blob-drift-2": {
          "0%, 100%": { transform: "translate3d(0, 0, 0) scale(1)" },
          "50%": { transform: "translate3d(50px, -25px, 0) scale(1.08)" },
        },
        "blob-fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "accent-line": {
          "0%": { transform: "scaleX(0)" },
          "100%": { transform: "scaleX(1)" },
        },
        "bubble-in": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-dot": {
          "0%, 80%, 100%": { opacity: "0.3", transform: "translateY(0) scale(0.85)" },
          "40%": { opacity: "1", transform: "translateY(-5px) scale(1)" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(1)", opacity: "0.4" },
          "100%": { transform: "scale(1.4)", opacity: "0" },
        },
        "check-draw": {
          "0%": { strokeDashoffset: "40" },
          "100%": { strokeDashoffset: "0" },
        },
        "check-circle-draw": {
          "0%": { strokeDashoffset: "180" },
          "100%": { strokeDashoffset: "0" },
        },
        "toast-in": {
          "0%": { opacity: "0", transform: "translateY(-8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { transform: "translateX(-120%) skewX(-20deg)" },
          "100%": { transform: "translateX(220%) skewX(-20deg)" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 300ms ease-out both",
        "fade-up-soft": "fade-up-soft 400ms ease-out both",
        "fade-up-card": "fade-up-card 500ms ease-out both",
        "blob-drift-1": "blob-fade-in 800ms ease-out both, blob-drift-1 14s ease-in-out 800ms infinite",
        "blob-drift-2": "blob-fade-in 800ms ease-out both, blob-drift-2 18s ease-in-out 800ms infinite",
        "accent-line": "accent-line 400ms ease-out 200ms both",
        "bubble-in": "bubble-in 200ms ease-out both",
        "pulse-dot": "pulse-dot 600ms ease-in-out infinite both",
        "pulse-ring": "pulse-ring 2s ease-out infinite",
        "check-draw": "check-draw 400ms ease-out 300ms forwards",
        "check-circle-draw": "check-circle-draw 500ms ease-out forwards",
        "toast-in": "toast-in 200ms ease-out both",
        shimmer: "shimmer 600ms ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
