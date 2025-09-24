import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Comparateur PDF",
  description:
    "Comparez deux fichiers PDF et obtenez un fichier de différences avec les modifications en surbrillance.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body suppressHydrationWarning={true}>{children}</body>
    </html>
  );
}
