import { Card, CardContent } from "@/components/ui/card";
import { ProfileSettingsForm } from "@/features/settings/components/ProfileSettingsForm";

export default function ProfilePage() {
  return (
    <div className="h-full overflow-auto p-6">
      <div className="space-y-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Profile</h1>
          <p className="text-sm text-muted-foreground">
            Manage personal credentials used by Project Manager.
          </p>
        </div>
        <Card className="max-w-3xl">
          <CardContent className="pt-6">
            <ProfileSettingsForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
