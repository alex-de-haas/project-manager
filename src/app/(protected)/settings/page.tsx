import { Card, CardContent } from "@/components/ui/card";
import { GeneralSettingsForm } from "@/features/settings/components/GeneralSettingsForm";
import { headers } from "next/headers";
import { readTrustedHostIdentity } from "@/lib/host-identity";
import { ensureHostUser } from "@/lib/host-users";

export default async function SettingsPage() {
  const headerStore = await headers();
  const identity = readTrustedHostIdentity(headerStore);
  const currentUser = identity ? ensureHostUser(identity) : null;

  if (!currentUser?.is_admin) {
    return (
      <div className="h-full overflow-auto p-6">
        <div className="rounded-md border p-4 text-sm text-muted-foreground">
          Settings are available to module administrators only.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="space-y-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage module roles, releases, general preferences, Azure DevOps integration, and AI options.
          </p>
        </div>
        <Card className="max-w-3xl">
          <CardContent className="pt-6">
            <GeneralSettingsForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
