import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { launchModeBootstrapScript } from "@hosty-sdk/app";
import { createThemeBootstrapScript } from "@hosty-sdk/app/theme";
import { AppIdentityBridge, HostLaunchBridge } from "@hosty-sdk/app/react";
import { HostThemeBridge } from "@/components/HostThemeBridge";

export const metadata: Metadata = {
  title: "Project Manager",
  description: "Plan releases and track project work",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

// The app runs next-themes for standalone use, so the host's bootstrap applies only a theme a shell
// declared and leaves the system case to the provider — the same switch `HostThemeBridge` passes.
const hostThemeBootstrapScript = createThemeBootstrapScript({ followSystem: false });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Ahead of any body markup, so chrome a shell already renders is never painted, and the
            first paint is already in the shell's theme. */}
        <script dangerouslySetInnerHTML={{ __html: launchModeBootstrapScript }} />
        <script dangerouslySetInnerHTML={{ __html: hostThemeBootstrapScript }} />
      </head>
      <body className="bg-background text-foreground">
        <AppIdentityBridge />
        <HostLaunchBridge />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          storageKey="project-manager-theme"
          disableTransitionOnChange
        >
          <HostThemeBridge />
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
