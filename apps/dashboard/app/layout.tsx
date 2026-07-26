import type { Metadata } from "next";

import "./globals.css";

import { GuildProvider } from "@/lib/guild/GuildProvider";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "GuildPass Dashboard",
  description:
    "GuildPass web dashboard for managing access, passes, and communities",
};

const themeScript = `
(function() {
  try {
    var theme = localStorage.getItem("theme");

    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else if (theme === "light") {
      document.documentElement.classList.remove("dark");
    } else if (
      window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      document.documentElement.classList.add("dark");
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: themeScript,
          }}
        />
      </head>

      <body>
        <ThemeProvider>
          <GuildProvider>{children}</GuildProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}