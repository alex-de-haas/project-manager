export const copyTextToClipboard = async (text: string) => {
  if (!window.isSecureContext || !navigator.clipboard?.writeText) {
    throw new Error("Clipboard API is not available in this browser context");
  }

  await navigator.clipboard.writeText(text);
};
