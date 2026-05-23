export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  buildOpenAICompatibleUrl,
  getAiProviderSettings,
  parseAiProviderSettings,
} from "@/lib/ai-provider-settings";
import { requireAdminUser } from "@/lib/authorization";
import { safeServerFetch } from "@/lib/safe-fetch";

interface ProviderModel {
  id: string;
}

interface ProviderModelsResponse {
  data?: ProviderModel[];
}

export async function POST(request: NextRequest) {
  try {
    const admin = requireAdminUser(request);
    if ("response" in admin) return admin.response;

    const body = await request.json().catch(() => ({}));
    const providedSettings = parseAiProviderSettings(body);
    const storedSettings = getAiProviderSettings();
    const baseUrl = providedSettings?.baseUrl || storedSettings?.baseUrl;

    if (!baseUrl) {
      return NextResponse.json(
        { error: "AI provider base URL is required" },
        { status: 400 }
      );
    }

    const modelsUrl = buildOpenAICompatibleUrl(baseUrl, "/v1/models");
    const response = await safeServerFetch(
      modelsUrl.toString(),
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      },
      {
        allowPrivateNetwork: true,
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: `AI provider returned ${response.status}: ${response.statusText}` },
        { status: response.status }
      );
    }

    const data = (await response.json()) as ProviderModelsResponse;
    const models = data.data?.map((model) => model.id).filter(Boolean) || [];

    return NextResponse.json({
      success: true,
      models,
      message:
        models.length > 0
          ? `Connection successful. Available models: ${models.join(", ")}`
          : "Connection successful. No models were returned.",
    });
  } catch (error) {
    console.error("AI provider test error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `Connection failed: ${error.message}`
            : "Failed to connect to the AI provider.",
      },
      { status: 500 }
    );
  }
}
