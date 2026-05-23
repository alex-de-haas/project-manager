"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [organization, setOrganization] = useState("");
  const [project, setProject] = useState("");
  const [pat, setPat] = useState("");
  const [hasPat, setHasPat] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">(
    "success"
  );

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await fetch("/api/settings?key=azure_devops");
      if (response.ok) {
        const data = await response.json();
        if (data.value) {
          const settings =
            typeof data.value === "string"
              ? JSON.parse(data.value)
              : data.value;
          setOrganization(settings.organization || "");
          setProject(settings.project || "");
          setHasPat(Boolean(settings.hasPat));
          setPat("");
        }
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    if (!organization || !project || (!pat && !hasPat)) {
      setMessage("Please fill in all fields before testing");
      setMessageType("error");
      return;
    }

    setTesting(true);
    setMessage("");
    try {
      const response = await fetch("/api/azure-devops/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization, project, pat }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage(
          `✓ Connection successful! Found project: ${data.project.name}`
        );
        setMessageType("success");
      } else {
        setMessage(`✗ Connection failed: ${data.error || "Unknown error"}`);
        setMessageType("error");
      }
    } catch (err) {
      setMessage("✗ Connection failed: Network error");
      setMessageType("error");
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "azure_devops",
          value: { organization, project, pat },
        }),
      });

      if (!response.ok) throw new Error("Failed to save settings");
      const data = await response.json().catch(() => null);
      if (data?.value) {
        setHasPat(Boolean(data.value.hasPat));
        setPat("");
      }

      setMessage("✓ Settings saved successfully!");
      setMessageType("success");
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      setMessage("✗ Failed to save settings");
      setMessageType("error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Azure DevOps Settings</DialogTitle>
          <DialogDescription>
            Configure your Azure DevOps connection to import work items
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="text-center py-8">Loading settings...</div>
        ) : (
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="organization">Organization</Label>
              <Input
                id="organization"
                type="text"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                placeholder="e.g., mycompany"
                required
              />
              <p className="text-xs text-muted-foreground">
                From: https://dev.azure.com/[organization]
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="project">Project</Label>
              <Input
                id="project"
                type="text"
                value={project}
                onChange={(e) => setProject(e.target.value)}
                placeholder="e.g., MyProject"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pat">Personal Access Token (PAT)</Label>
              <Input
                id="pat"
                type="password"
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                placeholder={hasPat ? "Personal PAT saved" : "Enter your Azure DevOps PAT"}
                required={!hasPat}
              />
              <p className="text-xs text-muted-foreground">
                {hasPat
                  ? "Leave blank to keep the saved personal PAT."
                  : "Create a PAT at: User Settings -> Personal access tokens -> New Token."}
              </p>
            </div>

            {message && (
              <Alert
                variant={messageType === "success" ? "default" : "destructive"}
                className={
                  messageType === "success"
                    ? "bg-green-50 border-green-200"
                    : ""
                }
              >
                <AlertDescription>{message}</AlertDescription>
              </Alert>
            )}

            <div className="flex gap-2 justify-between pt-4">
              <Button
                type="button"
                onClick={handleTest}
                disabled={testing || saving}
                variant="outline"
                className="border-blue-600 text-blue-600 hover:bg-blue-50"
              >
                {testing ? "Testing..." : "Test Connection"}
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Save Settings"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
