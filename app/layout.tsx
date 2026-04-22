import type { Metadata } from "next";
import { Inter, Lora } from "next/font/google";
import { TestModeBanner } from "@/components/ui/TestModeBanner";
import "../styles/globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

const lora = Lora({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-lora",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Support Center",
  description: "We're here to help with your order.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${lora.variable}`}>
      <body className="min-h-screen font-sans">
        <TestModeBanner />
        {children}
      </body>
    </html>
  );
}
