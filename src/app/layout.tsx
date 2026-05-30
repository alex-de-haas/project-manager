import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { HostIdentityBridge } from "@/components/HostIdentityBridge";

export const metadata: Metadata = {
  title: "Project Manager",
  description: "Plan releases and track project work",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          forcedTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <HostIdentityBridge />
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
