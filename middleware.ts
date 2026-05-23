import { NextRequest, NextResponse } from "next/server";
import {
  DOCKER_HOST_IDENTITY_HEADER,
  requestHeadersWithTrustedHostIdentity,
  verifyDockerHostIdentityToken,
} from "@/lib/host-identity";

const PUBLIC_PATHS = [
  "/api/health",
];

const isPublicPath = (pathname: string) => {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname.startsWith("/favicon")) return true;
  if (pathname.startsWith("/icons/")) return true;
  return false;
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const claims = await verifyDockerHostIdentityToken(
    request.headers.get(DOCKER_HOST_IDENTITY_HEADER)
  );

  if (claims) {
    return NextResponse.next({
      request: {
        headers: requestHeadersWithTrustedHostIdentity(request.headers, claims),
      },
    });
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Docker Host identity is required" },
      { status: 401 }
    );
  }

  return new NextResponse("Docker Host identity is required", {
    status: 401,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export const config = {
  matcher: ["/((?!.*\\..*).*)"],
};
