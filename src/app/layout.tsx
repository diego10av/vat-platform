import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Luxembourg VAT Platform",
  description: "Internal VAT compliance tool for Luxembourg fund entities",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-gray-50 text-gray-900">
        <nav className="bg-[#1a1a2e] text-white px-6 py-3 flex items-center justify-between">
          <a href="/" className="font-bold text-lg tracking-tight">Luxembourg VAT Platform</a>
          <div className="flex gap-6 text-sm">
            <a href="/entities" className="hover:text-gray-300">Entities</a>
            <a href="/declarations" className="hover:text-gray-300">Declarations</a>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
