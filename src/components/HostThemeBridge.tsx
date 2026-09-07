"use client";

import { useCallback } from "react";
import { useTheme } from "next-themes";
import { HostThemeBridge as SdkHostThemeBridge } from "@hosty-sdk/app/react";
import type { HostyResolvedTheme } from "@hosty-sdk/app/theme";

const nextThemesStorageKey = "project-manager-theme";

// The SDK bridge owns the host protocol and writes the root; what stays here is the hand-off to
// next-themes, which renders the app's own components (notifications, the toggle) off its own state
// and would otherwise put its stored choice back. `followSystem` is off because next-themes owns the
// standalone case: the operating system must not overwrite a theme the operator picked with the
// toggle, and the SDK's bootstrap in the layout is created with the same switch.
export function HostThemeBridge() {
  const { setTheme } = useTheme();
  const onTheme = useCallback(
    (theme: HostyResolvedTheme) => {
      setTheme(theme);
      try {
        window.localStorage.removeItem(nextThemesStorageKey);
      } catch {}
    },
    [setTheme],
  );

  return <SdkHostThemeBridge followSystem={false} onTheme={onTheme} />;
}
