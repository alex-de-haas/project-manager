import { toast as sonnerToast, type ExternalToast } from "sonner";

const stickyErrorOptions = {
  closeButton: true,
  dismissible: true,
  duration: Infinity,
  richColors: true,
} satisfies Pick<ExternalToast, "closeButton" | "dismissible" | "duration" | "richColors">;

const error: typeof sonnerToast.error = (message, data) =>
  sonnerToast.error(message, {
    ...data,
    ...stickyErrorOptions,
  });

const toastWithStickyErrors = ((...args: Parameters<typeof sonnerToast>) =>
  sonnerToast(...args)) as typeof sonnerToast;

export const toast = Object.assign(toastWithStickyErrors, sonnerToast, { error });
