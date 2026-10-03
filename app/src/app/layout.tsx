import type { Metadata } from "next";
import { WalletContextProvider } from "../components/WalletContextProvider";
import "./globals.css";

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
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#0B0E11] text-[#B7BDC6] antialiased">
        <WalletContextProvider>{children}</WalletContextProvider>
      </body>
    </html>
  );
}
