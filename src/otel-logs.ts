import { AsyncLocalStorage } from "node:async_hooks";
import { format } from "node:util";

import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { detectResources, envDetector } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";

type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug";

let configured = false;

// Best-effort scrubbing of high-confidence secrets before a record leaves the process. The bridge
// ships whatever `console.*` was handed (often `console.error('...:', err)` whose stack/message can
// embed tokens or connection strings), so redaction here is a safety net — call sites should still
// avoid logging raw credentials/parameters. Kept conservative to preserve debuggability.
const REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  // Bearer tokens in Authorization headers or free text.
  [/\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]"],
  // key/value secrets: token=..., password: "...", api_key=..., client_secret=..., pat=...
  [
    /\b(pat|tokens?|secrets?|passwords?|passwd|pwd|api[_-]?keys?|access[_-]?tokens?|refresh[_-]?tokens?|client[_-]?secrets?|authorization)(["']?\s*[:=]\s*["']?)[^\s"',;]+/gi,
    "$1$2[REDACTED]",
  ],
];

const redact = (message: string): string =>
  REDACTIONS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), message);

// Rate limit how many records the bridge ships to OTLP so an error storm cannot flood the
// collector with unbounded structured logs. Records beyond the budget are still printed to
// stdout/stderr (via the original console); only the OTLP copy is dropped, with one notice per
// window so the gap is visible downstream.
const LOG_RATE_WINDOW_MS = 10_000;
const LOG_RATE_MAX = 200;
let rateWindowStart = 0;
let rateWindowCount = 0;

// Set while the exporter is shipping a batch, so any console output the exporter or the network stack
// emits during the (async) export is NOT re-ingested — prevents an export-failure → log → export
// cascade that the synchronous `emitting` flag below cannot catch.
const exportSuppression = new AsyncLocalStorage<boolean>();

// Bridge console.* into the OpenTelemetry logs signal so application logs reach the Hosty collector as
// structured OTLP records — with severity and (when emitted inside a span) trace_id/span_id
// correlation — while still printing to stdout/stderr. Hosty keeps the console (`docker logs`) and OTLP
// log streams separate and surfaces them in distinct views, so feeding both is intended, not double
// logging. The log resource is detected from the injected OTEL_RESOURCE_ATTRIBUTES (incl. hosty.app.id,
// which Core uses to attribute each record to this app). See docs/features/observability.md in the
// Hosty Core platform repo (not this one).
export function setupOtlpLogs(): void {
  if (configured) return;
  configured = true;

  // The OTLP/proto exporter reads OTEL_EXPORTER_OTLP_ENDPOINT (appends /v1/logs) from the environment.
  // Wrap export() so the whole async ship runs inside the suppression context (see exportSuppression).
  const exporter = new OTLPLogExporter();
  const originalExport = exporter.export.bind(exporter);
  exporter.export = (records, resultCallback) =>
    exportSuppression.run(true, () => originalExport(records, resultCallback));

  const provider = new LoggerProvider({
    resource: detectResources({ detectors: [envDetector] }),
    processors: [new BatchLogRecordProcessor({ exporter })],
  });
  logs.setGlobalLoggerProvider(provider);

  // Flush buffered records on container stop (SIGTERM) / Ctrl-C (SIGINT) so the last ~5s batch isn't
  // lost. These are additive `once` listeners — Next's own shutdown handling still runs.
  const shutdown = (): void => {
    void provider.shutdown().catch(() => undefined);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  const logger = logs.getLogger("console");
  const levels: ReadonlyArray<[ConsoleMethod, SeverityNumber, string]> = [
    ["log", SeverityNumber.INFO, "INFO"],
    ["info", SeverityNumber.INFO, "INFO"],
    ["warn", SeverityNumber.WARN, "WARN"],
    ["error", SeverityNumber.ERROR, "ERROR"],
    ["debug", SeverityNumber.DEBUG, "DEBUG"],
  ];

  // Ship a redacted record to OTLP unless the per-window budget is exhausted. Returns silently
  // when rate-limited (the record was already printed to the console by the caller).
  const emitRecord = (
    severityNumber: SeverityNumber,
    severityText: string,
    rawBody: string
  ): void => {
    const now = Date.now();
    if (now - rateWindowStart >= LOG_RATE_WINDOW_MS) {
      rateWindowStart = now;
      rateWindowCount = 0;
    }
    rateWindowCount += 1;

    if (rateWindowCount > LOG_RATE_MAX) {
      // Emit exactly one boundary notice so the dropped tail is visible in OTLP.
      if (rateWindowCount === LOG_RATE_MAX + 1) {
        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: `console→OTLP log rate limit reached (${LOG_RATE_MAX} records / ${LOG_RATE_WINDOW_MS}ms); further records this window are dropped from OTLP (still on stdout/stderr).`,
        });
      }
      return;
    }

    logger.emit({ severityNumber, severityText, body: redact(rawBody) });
  };

  const target = console as unknown as Record<ConsoleMethod, (...args: unknown[]) => void>;
  let emitting = false;
  for (const [method, severityNumber, severityText] of levels) {
    const original = target[method].bind(console);
    target[method] = (...args: unknown[]): void => {
      original(...args);
      // Skip re-ingestion: the synchronous `emitting` flag guards direct recursion, and
      // exportSuppression catches console output emitted asynchronously from within the exporter.
      if (emitting || exportSuppression.getStore()) return;
      emitting = true;
      try {
        emitRecord(severityNumber, severityText, format(...args));
      } catch {
        // Telemetry must never break the app.
      } finally {
        emitting = false;
      }
    };
  }
}
