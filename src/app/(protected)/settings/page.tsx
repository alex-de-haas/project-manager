import { Card, CardContent } from "@/components/ui/card";
import { GeneralSettingsForm } from "@/features/settings/components/GeneralSettingsForm";
import { headers } from "next/headers";
import { readTrustedHostIdentity } from "@/lib/host-identity";
import { ensureHostUser } from "@/lib/host-users";

export default async function SettingsPage() {
  const headerStore = await headers();
  const identity = readTrustedHostIdentity(headerStore);
  const currentUser = identity ? ensureHostUser(identity) : null;

  return (
    <div className="h-full overflow-auto p-6">
      <div className="space-y-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage your profile and, for administrators, module projects and integrations.
          </p>
        </div>
        <Card className="max-w-3xl">
          <CardContent className="pt-6">
            <GeneralSettingsForm isAdmin={Boolean(currentUser?.is_admin)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
