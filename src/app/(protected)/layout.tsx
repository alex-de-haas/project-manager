import { cookies } from "next/headers";
import TopNavigation from "@/components/TopNavigation";
import { headers } from "next/headers";
import { readTrustedHostIdentity } from "@/lib/host-identity";
import { ensureHostUser } from "@/lib/host-users";
import { PROJECT_COOKIE_NAME } from "@/lib/user-context";
import { getProjectsForUser } from "@/lib/projects";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headerStore = await headers();
  const hostIdentity = readTrustedHostIdentity(headerStore);

  if (!hostIdentity) {
    return (
      <div
        data-project-manager-host-identity="missing"
        className="flex min-h-dvh items-center justify-center px-6 text-sm text-muted-foreground"
      >
        Docker Host identity is required.
      </div>
    );
  }

  const currentUser = ensureHostUser(hostIdentity);
  const cookieStore = await cookies();
  const projects = getProjectsForUser(currentUser.id);
  const cookieProjectId = cookieStore.get(PROJECT_COOKIE_NAME)?.value ?? "";
  const activeProjectId = projects.some(
    (project) => String(project.id) === cookieProjectId
  )
    ? cookieProjectId
    : projects[0]
    ? String(projects[0].id)
    : "";

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopNavigation
        initialUser={currentUser}
        initialProjects={projects}
        initialActiveProjectId={activeProjectId}
      />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
