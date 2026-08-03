import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IUNA 2.0",
  description: "A Next.js app created in the current workspace",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
