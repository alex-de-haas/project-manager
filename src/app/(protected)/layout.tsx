import { cookies } from "next/headers";
import TopNavigation from "@/components/TopNavigation";
import { headers } from "next/headers";
import {
  INTERNAL_HOST_LAUNCH_CODE_HEADER,
  readAppIdentityToken,
  resolveTrustedHostIdentity,
} from "@/lib/host-identity";
import { ensureHostUser } from "@/lib/host-users";
import { PROJECT_COOKIE_NAME, PROJECT_USER_COOKIE_NAME } from "@/lib/user-context";
import { getProjectsForUser } from "@/lib/projects";
import { getDefaultProjectIdForUser } from "@/lib/default-project";
import { describeOpaqueValue, logHostAuthDebug } from "@/lib/host-auth-debug";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headerStore = await headers();
  const hostIdentity = await resolveTrustedHostIdentity(headerStore);
  const isLaunchCodeBootstrap = headerStore.get(INTERNAL_HOST_LAUNCH_CODE_HEADER) === "1";

  if (!hostIdentity) {
    if (isLaunchCodeBootstrap) {
      return (
        <div
          data-project-manager-auth-bootstrap="launch-code"
          className="min-h-dvh bg-muted/30"
        />
      );
    }

    const tokenInput = readAppIdentityToken(headerStore);
    logHostAuthDebug("protected layout missing trusted identity", {
      tokenSource: tokenInput.source,
      token: describeOpaqueValue(tokenInput.token),
    });
    return (
      <div
        data-project-manager-host-identity="missing"
        className="flex min-h-dvh items-center justify-center px-6 text-sm text-muted-foreground"
      >
        Hosty app identity is required.
      </div>
    );
  }

  const currentUser = ensureHostUser(hostIdentity);
  const cookieStore = await cookies();
  const projects = getProjectsForUser(currentUser.id);
  const cookieUserId = cookieStore.get(PROJECT_USER_COOKIE_NAME)?.value ?? "";
  const cookieProjectId = cookieUserId === String(currentUser.id)
    ? cookieStore.get(PROJECT_COOKIE_NAME)?.value ?? ""
    : "";
  const defaultProjectId = getDefaultProjectIdForUser(currentUser.id);
  const activeProjectId = projects.some(
    (project) => String(project.id) === cookieProjectId
  )
    ? cookieProjectId
    : defaultProjectId && projects.some((project) => project.id === defaultProjectId)
    ? String(defaultProjectId)
    : projects[0]
    ? String(projects[0].id)
    : "";

  return (
    <div
      data-project-manager-host-identity="present"
      data-host-user-id={hostIdentity.id}
      data-host-user-email={hostIdentity.email ?? ""}
      data-host-user-name={hostIdentity.name ?? ""}
      data-host-role={hostIdentity.hostRole ?? ""}
      className="flex h-dvh flex-col overflow-hidden bg-muted/30"
    >
      <TopNavigation
        initialUser={currentUser}
        initialProjects={projects}
        initialActiveProjectId={activeProjectId}
        initialDefaultProjectId={defaultProjectId ? String(defaultProjectId) : ""}
      />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
