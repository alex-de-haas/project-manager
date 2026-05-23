import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

const moduleFetchBridgeScript = `
(() => {
  if (window.__projectManagerFetchBridgeInstalled) return;
  const match = window.location.pathname.match(
    /^\\/api\\/apps\\/((?:dev\\/)?[^/]+)\\/embed(?:\\/.*)?\\/?$/
  );
  if (!match) return;

  const appPath = match[1];
  const nextStaticPrefix = "/_next/static/";
  const nextStaticReferencePattern = /\\/\\_next\\/static\\/[^"',\\]\\s]+/g;
  const embedUrl = new URL(window.location.href);
  let embedToken = embedUrl.searchParams.get("embedToken");
  const originalFetch = window.fetch.bind(window);
  const getEmbedToken = () => {
    if (embedToken) return embedToken;
    const tokenSource = document.querySelector("[src*='embedToken='],[href*='embedToken=']");
    const tokenUrl =
      tokenSource?.getAttribute("src") || tokenSource?.getAttribute("href");
    if (tokenUrl) {
      embedToken = new URL(tokenUrl, window.location.origin).searchParams.get("embedToken");
    }
    return embedToken;
  };
  const toEmbedUrl = (pathAndSearch) =>
    "/api/apps/" +
    appPath +
    "/embed?path=" +
    encodeURIComponent(pathAndSearch) +
    (getEmbedToken() ? "&embedToken=" + encodeURIComponent(getEmbedToken()) : "");
  const withEmbedCredentials = (init) => ({ ...init, credentials: "include" });
  const toEmbedAssetUrl = (url) => toEmbedUrl(url.pathname);
  const isSameOriginRequest = (url) => url.origin === window.location.origin;
  const shouldRewriteApiRequest = (url) =>
    isSameOriginRequest(url) &&
    url.pathname.startsWith("/api/") &&
    !url.pathname.startsWith("/api/apps/");
  const shouldRewriteNextAssetRequest = (url) =>
    isSameOriginRequest(url) && url.pathname.startsWith(nextStaticPrefix);
  const shouldRewriteNextRouteRequest = (url) =>
    isSameOriginRequest(url) &&
    !url.pathname.startsWith("/api/apps/") &&
    url.searchParams.has("_rsc");
  const rewriteUrlIfNeeded = (value) => {
    const url = new URL(value, window.location.origin);
    if (shouldRewriteApiRequest(url)) return toEmbedUrl(url.pathname + url.search);
    if (shouldRewriteNextAssetRequest(url)) return toEmbedAssetUrl(url);
    if (shouldRewriteNextRouteRequest(url)) return toEmbedUrl(url.pathname + url.search);
    return value;
  };
  const rewriteNextStaticReference = (value) =>
    typeof value === "string"
      ? value.replace(nextStaticReferencePattern, (assetPath) => toEmbedUrl(assetPath))
      : value;
  const rewriteNextFlightValue = (value) => {
    if (typeof value === "string") return rewriteNextStaticReference(value);
    if (Array.isArray(value)) return value.map(rewriteNextFlightValue);
    return value;
  };

  window.fetch = (input, init) => {
    if (typeof input === "string" || input instanceof URL) {
      const rewritten = rewriteUrlIfNeeded(input);
      return originalFetch(rewritten, rewritten === input ? init : withEmbedCredentials(init));
    }

    if (input instanceof Request) {
      const url = new URL(input.url, window.location.origin);
      if (
        shouldRewriteApiRequest(url) ||
        shouldRewriteNextAssetRequest(url) ||
        shouldRewriteNextRouteRequest(url)
      ) {
        return originalFetch(new Request(rewriteUrlIfNeeded(url), input), withEmbedCredentials(init));
      }
    }

    return originalFetch(input, init);
  };

  const patchNextFlightQueue = (queue) => {
    if (!queue || queue.__projectManagerPatched) return queue;
    for (let index = 0; index < queue.length; index += 1) {
      queue[index] = rewriteNextFlightValue(queue[index]);
    }
    const originalNextFlightPush = queue.push.bind(queue);
    queue.push = (...items) =>
      originalNextFlightPush(...items.map(rewriteNextFlightValue));
    Object.defineProperty(queue, "__projectManagerPatched", {
      value: true,
      configurable: true,
    });
    return queue;
  };
  let nextFlightQueue = patchNextFlightQueue(window.__next_f || []);
  Object.defineProperty(window, "__next_f", {
    configurable: true,
    get() {
      return nextFlightQueue;
    },
    set(value) {
      nextFlightQueue = patchNextFlightQueue(value || []);
    },
  });
  window.__next_f = nextFlightQueue;

  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function setAttribute(name, value) {
    const attributeName = String(name).toLowerCase();
    if ((attributeName === "src" || attributeName === "href") && typeof value === "string") {
      return originalSetAttribute.call(this, name, rewriteUrlIfNeeded(value));
    }
    return originalSetAttribute.call(this, name, value);
  };

  const scriptSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, "src");
  if (scriptSrcDescriptor?.set && scriptSrcDescriptor?.get) {
    Object.defineProperty(HTMLScriptElement.prototype, "src", {
      configurable: true,
      enumerable: scriptSrcDescriptor.enumerable,
      get() {
        return scriptSrcDescriptor.get.call(this);
      },
      set(value) {
        scriptSrcDescriptor.set.call(this, rewriteUrlIfNeeded(String(value)));
      },
    });
  }

  const linkHrefDescriptor = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, "href");
  if (linkHrefDescriptor?.set && linkHrefDescriptor?.get) {
    Object.defineProperty(HTMLLinkElement.prototype, "href", {
      configurable: true,
      enumerable: linkHrefDescriptor.enumerable,
      get() {
        return linkHrefDescriptor.get.call(this);
      },
      set(value) {
        linkHrefDescriptor.set.call(this, rewriteUrlIfNeeded(String(value)));
      },
    });
  }

  window.__projectManagerFetchBridgeInstalled = true;
})();
`;

export const metadata: Metadata = {
  title: "Time Tracker",
  description: "Track time spent on tasks and bugs",
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
      <head>
        <script dangerouslySetInnerHTML={{ __html: moduleFetchBridgeScript }} />
      </head>
      <body className="bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          forcedTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
