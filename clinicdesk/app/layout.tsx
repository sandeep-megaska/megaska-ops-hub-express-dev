import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClinicDesk",
  description: "Booking, clinical records and billing for allied-health practices.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
