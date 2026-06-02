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

export const toast = new Proxy(sonnerToast, {
  get(target, prop, receiver) {
    if (prop === "error") {
      return error;
    }

    return Reflect.get(target, prop, receiver);
  },
}) as typeof sonnerToast;
