const copyTextWithSelectionFallback = (text: string): boolean => {
  const activeElement = document.activeElement as HTMLElement | null;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
    activeElement?.focus?.({ preventScroll: true });
  }
};

const isEmbeddedInFrame = () => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

export const copyTextToClipboard = async (text: string) => {
  if (copyTextWithSelectionFallback(text)) {
    return;
  }

  if (!isEmbeddedInFrame() && window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to a consistent error for browser permission denials.
    }
  }

  throw new Error("Clipboard write permission denied");
};
