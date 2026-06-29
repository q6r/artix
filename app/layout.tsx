import type { Metadata } from "next";
import { Fustat, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import "flag-icons/css/flag-icons.min.css";
import { getLocale } from "@/lib/i18n";
import { LanguageProvider } from "@/components/LanguageProvider";
import { AuthProvider } from "@/components/AuthProvider";
import AnnouncementHost from "@/components/AnnouncementHost";

const fustat = Fustat({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const ethnocentric = localFont({
  src: "../public/fonts/Ethnocentric-Regular.otf",
  variable: "--font-logo",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ArtixCloud",
  description: "Cloud VPS de alta performance — ArtixCloud",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      className={`dark ${fustat.variable} ${geistMono.variable} ${ethnocentric.variable} h-full antialiased`}
    >
      <body className="relative min-h-full flex flex-col bg-black text-white">
        <LanguageProvider initialLocale={locale}>
          <AuthProvider>
            <AnnouncementHost />
            {children}
          </AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
