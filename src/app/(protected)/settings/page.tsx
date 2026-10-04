"use client";

import { Card, CardContent } from "@/components/ui/card";
import { GeneralSettingsForm } from "@/features/settings/components/GeneralSettingsForm";
import { useAppContext } from "@/components/AppContext";

export default function SettingsPage() {
  const currentUser = useAppContext()?.user;

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage your profile and, for Host administrators, app projects and integrations.
          </p>
        </div>
        <Card className="w-full">
          <CardContent className="pt-6">
            <GeneralSettingsForm isAdmin={Boolean(currentUser?.is_admin)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
