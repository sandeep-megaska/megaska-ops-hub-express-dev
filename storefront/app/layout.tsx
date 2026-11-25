import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

const indexable = process.env.SITE_INDEXABLE === "true";

export const metadata: Metadata = {
  title: { default: "Megaska", template: "%s | Megaska" },
  description: "Swimwear and activewear by Megaska.",
  robots: indexable ? undefined : { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        {!indexable && <div className="banner">Test storefront · prices and stock mirror megaska.com</div>}
        <header className="header">
          <div className="wrap">
            <Link href="/" className="logo">MEGASKA</Link>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="footer">
          <div className="wrap">© Megaska</div>
        </footer>
      </body>
    </html>
  );
}
