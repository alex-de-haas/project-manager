"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";

type HostyResolvedTheme = "light" | "dark";
type HostyThemePreference = "light" | "dark" | "system";

const resolvedThemeStorageKey = "hosty.theme.resolved";
const themePreferenceStorageKey = "hosty.theme.preference";
const nextThemesStorageKey = "project-manager-theme";

export function HostThemeBridge() {
  const { setTheme } = useTheme();
  const setThemeRef = useRef(setTheme);

  useEffect(() => {
    setThemeRef.current = setTheme;
  }, [setTheme]);

  useEffect(() => {
    const urlTheme = getUrlTheme();
    const storedTheme = getStoredTheme();

    if (urlTheme) {
      applyTheme(urlTheme, getUrlThemePreference() ?? urlTheme, true, setThemeRef.current);
    } else if (storedTheme) {
      applyTheme(storedTheme, getStoredThemePreference() ?? storedTheme, true, setThemeRef.current);
    }

    cleanUrlThemeParams();

    const expectedParentOrigin = getExpectedParentOrigin();
    const handleMessage = (event: MessageEvent) => {
      if (window.parent === window || event.source !== window.parent) {
        return;
      }

      if (expectedParentOrigin && event.origin !== expectedParentOrigin) {
        return;
      }

      const data = event.data;
      if (!data || typeof data !== "object" || (data as { type?: unknown }).type !== "hosty:shell-theme") {
        return;
      }

      const theme = normalizeResolvedTheme((data as { theme?: unknown }).theme);
      if (!theme) {
        return;
      }

      applyTheme(
        theme,
        normalizeThemePreference((data as { preference?: unknown }).preference) ?? theme,
        true,
        setThemeRef.current
      );
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  return null;
}

function applyTheme(
  theme: HostyResolvedTheme,
  preference: HostyThemePreference,
  persist: boolean,
  setTheme: (theme: string) => void
) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  root.dataset.hostyTheme = theme;
  root.dataset.hostyThemePreference = preference;

  setTheme(theme);
  removeLocalStorage(nextThemesStorageKey);

  if (persist) {
    writeSessionStorage(resolvedThemeStorageKey, theme);
    writeSessionStorage(themePreferenceStorageKey, preference);
  } else {
    removeSessionStorage(resolvedThemeStorageKey);
    removeSessionStorage(themePreferenceStorageKey);
  }
}

function getUrlTheme() {
  return normalizeResolvedTheme(new URL(window.location.href).searchParams.get("hosty_theme"));
}

function getUrlThemePreference() {
  return normalizeThemePreference(new URL(window.location.href).searchParams.get("hosty_theme_preference"));
}

function getStoredTheme() {
  return normalizeResolvedTheme(readSessionStorage(resolvedThemeStorageKey));
}

function getStoredThemePreference() {
  return normalizeThemePreference(readSessionStorage(themePreferenceStorageKey));
}

function normalizeResolvedTheme(value: unknown): HostyResolvedTheme | null {
  return value === "light" || value === "dark" ? value : null;
}

function normalizeThemePreference(value: unknown): HostyThemePreference | null {
  return value === "light" || value === "dark" || value === "system" ? value : null;
}

function cleanUrlThemeParams() {
  const url = new URL(window.location.href);
  const hadThemeParams = url.searchParams.has("hosty_theme") || url.searchParams.has("hosty_theme_preference");
  if (!hadThemeParams) {
    return;
  }

  url.searchParams.delete("hosty_theme");
  url.searchParams.delete("hosty_theme_preference");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function getExpectedParentOrigin() {
  if (!document.referrer) {
    return null;
  }

  try {
    const referrerOrigin = new URL(document.referrer).origin;
    return referrerOrigin === window.location.origin ? null : referrerOrigin;
  } catch {
    return null;
  }
}

function readSessionStorage(key: string) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSessionStorage(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {}
}

function removeSessionStorage(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {}
}

function removeLocalStorage(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {}
}
