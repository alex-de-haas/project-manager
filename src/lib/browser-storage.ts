export const readLocalStorage = (key: string): string | null => {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const writeLocalStorage = (key: string, value: string) => {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Docker Host embeds module apps in a sandboxed iframe where localStorage may be unavailable.
  }
};

export const removeLocalStorage = (key: string) => {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(key);
  } catch {
    // Docker Host embeds module apps in a sandboxed iframe where localStorage may be unavailable.
  }
};
