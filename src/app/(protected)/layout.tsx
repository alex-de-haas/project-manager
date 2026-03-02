import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Sidebar from "@/components/Sidebar";
import db from "@/lib/db";
import { AUTH_COOKIE_NAME, verifyAuthToken } from "@/lib/auth";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const authToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const payload = verifyAuthToken(authToken);

  if (!payload) {
    redirect("/login");
  }

  const user = db
    .prepare("SELECT id FROM users WHERE id = ?")
    .get(payload.uid) as { id: number } | undefined;

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />
      <main className="flex h-dvh min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
