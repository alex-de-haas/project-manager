import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import db from "@/lib/db";
import { getDataDirPath } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const dataDir = getDataDirPath();
    fs.mkdirSync(dataDir, { recursive: true });

    const probePath = path.join(dataDir, ".healthcheck");
    fs.writeFileSync(probePath, new Date().toISOString());
    fs.unlinkSync(probePath);

    db.prepare("SELECT 1").get();

    return NextResponse.json({
      ok: true,
      storage: "writable",
      database: "ready",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Health check failed",
      },
      { status: 503 }
    );
  }
}
