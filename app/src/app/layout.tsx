import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Epoch | Frequent Batch Auction Perps on Solana",
  description: "Uniform price batch-auction perpetual futures exchange on Solana",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "monospace", margin: 0, padding: 24, backgroundColor: "#0a0a0a", color: "#ededed" }}>
        {children}
      </body>
    </html>
  );
}
