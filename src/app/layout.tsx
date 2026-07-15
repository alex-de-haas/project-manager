import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { HostIdentityBridge } from "@/components/HostIdentityBridge";
import { HostThemeBridge } from "@/components/HostThemeBridge";
import { getAppId, getHostyCorePublicOrigin } from "@/lib/module-runtime";

export const metadata: Metadata = {
  title: "Project Manager",
  description: "Plan releases and track project work",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

const hostThemeBootstrapScript = `
(() => {
  try {
    const params = new URLSearchParams(window.location.search);
    const queryTheme = params.get("hosty_theme");
    const readSessionStorage = (key) => {
      try {
        return window.sessionStorage.getItem(key);
      } catch {
        return null;
      }
    };
    const storedTheme = readSessionStorage("hosty.theme.resolved");
    const theme = queryTheme === "dark" || queryTheme === "light"
      ? queryTheme
      : storedTheme === "dark" || storedTheme === "light"
        ? storedTheme
        : null;

    if (!theme) {
      return;
    }

    const queryPreference = params.get("hosty_theme_preference");
    const storedPreference = readSessionStorage("hosty.theme.preference");
    const preference = queryPreference === "light" || queryPreference === "dark" || queryPreference === "system"
      ? queryPreference
      : storedPreference === "light" || storedPreference === "dark" || storedPreference === "system"
        ? storedPreference
        : theme;
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
    root.dataset.hostyTheme = theme;
    root.dataset.hostyThemePreference = preference;
  } catch {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const corePublicOrigin = getHostyCorePublicOrigin() ?? "";
  const appId = getAppId();

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground">
        <script dangerouslySetInnerHTML={{ __html: hostThemeBootstrapScript }} />
        <HostIdentityBridge corePublicOrigin={corePublicOrigin} appId={appId} />
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
