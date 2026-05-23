import db from "@/lib/db";

export const AI_PROVIDER_SETTING_KEY = "ai_provider";

export interface AiProviderSettings {
  baseUrl: string;
  model: string;
}

interface ModuleSettingRow {
  value: string;
}

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, "");

export const parseAiProviderSettings = (value: unknown): AiProviderSettings | null => {
  let parsed = value;

  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const source = parsed as Record<string, unknown>;
  const rawBaseUrl =
    typeof source.baseUrl === "string"
      ? source.baseUrl
      : typeof source.endpoint === "string"
        ? source.endpoint
        : "";
  const rawModel = typeof source.model === "string" ? source.model : "";

  return {
    baseUrl: normalizeBaseUrl(rawBaseUrl),
    model: rawModel.trim(),
  };
};

export const getAiProviderSettings = (): AiProviderSettings | null => {
  const row = db
    .prepare("SELECT value FROM module_settings WHERE key = ?")
    .get(AI_PROVIDER_SETTING_KEY) as ModuleSettingRow | undefined;

  return row ? parseAiProviderSettings(row.value) : null;
};

export const hasConfiguredAiProvider = (
  settings: AiProviderSettings | null
): settings is AiProviderSettings => Boolean(settings?.baseUrl && settings.model);

export const upsertAiProviderSettings = (settings: AiProviderSettings) => {
  const value = JSON.stringify({
    baseUrl: normalizeBaseUrl(settings.baseUrl),
    model: settings.model.trim(),
  });

  db.prepare(
    `INSERT INTO module_settings (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = CURRENT_TIMESTAMP`
  ).run(AI_PROVIDER_SETTING_KEY, value);
};

export const deleteAiProviderSettings = () => {
  db.prepare("DELETE FROM module_settings WHERE key = ?").run(AI_PROVIDER_SETTING_KEY);
};

export const buildOpenAICompatibleUrl = (baseUrl: string, endpointPath: string): URL => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const base = new URL(normalizedBase);
  const basePath = base.pathname.replace(/\/+$/, "");
  const path = endpointPath.replace(/^\/+/, "");
  const pathWithoutVersion = path.startsWith("v1/") ? path.slice(3) : path;

  return new URL(basePath.endsWith("/v1") ? pathWithoutVersion : path, base);
};
