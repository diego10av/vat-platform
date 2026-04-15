import type { Metadata } from "next";
import "./globals.css";
import SearchBar from "@/components/SearchBar";

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
        <nav className="bg-[#1a1a2e] text-white px-6 py-2.5 flex items-center justify-between gap-4">
          <a href="/" className="font-bold text-[15px] tracking-tight whitespace-nowrap">Luxembourg VAT Platform</a>
          <div className="flex items-center gap-6 text-[13px]">
            <a href="/entities" className="hover:text-gray-300 transition-colors">Entities</a>
            <a href="/declarations" className="hover:text-gray-300 transition-colors">Declarations</a>
            <a href="/deadlines" className="hover:text-gray-300 transition-colors">Deadlines</a>
            <a href="/aed-letters" className="hover:text-gray-300 transition-colors">AED letters</a>
            <a href="/audit" className="hover:text-gray-300 transition-colors">Audit</a>
            <a href="/metrics" className="hover:text-gray-300 transition-colors">Metrics</a>
            <a href="/settings" className="hover:text-gray-300 transition-colors">Settings</a>
          </div>
          <SearchBar />
        </nav>
        <main className="max-w-7xl mx-auto px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
