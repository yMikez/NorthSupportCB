import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#ecfdf5",
          100: "#d1fae5",
          200: "#a7f3d0",
          300: "#6ee7b7",
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
          800: "#065f46",
          900: "#064e3b",
          950: "#052e16",
        },
        neutral: {
          50: "#fafaf9",
          100: "#f5f5f4",
          200: "#e7e5e4",
          300: "#d6d3d1",
          400: "#a8a29e",
          500: "#78716c",
          600: "#57534e",
          700: "#44403c",
          800: "#292524",
          900: "#1c1917",
        },
        ink: {
          900: "#0a0f0a",
          950: "#070b07",
        },
        success: "#10b981",
        warning: "#f59e0b",
        error: "#ef4444",
        info: "#3b82f6",
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
        ring: "0 0 0 4px rgba(16, 185, 129, 0.12)",
        glass:
          "0 0 0 1px rgba(16,185,129,0.15), 0 32px 64px rgba(0,0,0,0.4), inset 0 0 80px rgba(16,185,129,0.06)",
        "glow-sm": "0 0 16px rgba(16,185,129,0.5)",
        "glow-md": "0 4px 24px rgba(16,185,129,0.4), inset 0 1px 0 rgba(255,255,255,0.1)",
        "glow-lg": "0 8px 32px rgba(16,185,129,0.5)",
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
