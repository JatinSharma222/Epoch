import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { WalletContextProvider } from "../components/WalletContextProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Epoch | Frequent Batch Auction Perps on Solana",
  description: "Uniform price batch-auction perpetual futures exchange on Solana",
  icons: {
    icon: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="bg-[#0B0E11] text-[#B7BDC6] font-sans antialiased">
        <WalletContextProvider>{children}</WalletContextProvider>
      </body>
    </html>
  );
}
