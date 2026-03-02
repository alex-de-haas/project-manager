import { Card, CardContent } from "@/components/ui/card";
import { GeneralSettingsForm } from "@/features/settings";

export default function SettingsPage() {
  return (
    <div className="h-full overflow-auto p-6">
      <div className="space-y-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage users, releases, general preferences, Azure DevOps integration, and AI options.
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
