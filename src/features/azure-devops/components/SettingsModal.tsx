"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
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
import { parseAzureDevOpsProjectUrl } from "@/lib/azure-devops/project-url";

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [projectUrl, setProjectUrl] = useState("");
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

  useEffect(() => {
    if (!message) return;

    if (messageType === "success") {
      toast.success(message);
    } else {
      toast.error(message);
    }

    setMessage("");
  }, [message, messageType]);

  const parsedProjectUrl = parseAzureDevOpsProjectUrl(projectUrl);
  const organization = parsedProjectUrl?.organization ?? "";
  const project = parsedProjectUrl?.project ?? "";

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
          setProjectUrl(settings.projectUrl || "");
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
    if (!parsedProjectUrl || (!pat && !hasPat)) {
      setMessage("Please enter a valid Azure DevOps project URL and account token before testing");
      setMessageType("error");
      return;
    }

    setTesting(true);
    setMessage("");
    try {
      const response = await fetch("/api/azure-devops/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectUrl: projectUrl.trim(), pat }),
      });

      const data = await response.json();

      if (response.ok) {
        const patUser =
          data.authenticatedUser?.displayName || data.authenticatedUser?.uniqueName;
        setMessage(
          `Connection successful. Found project: ${data.project.name}${
            patUser ? `. Linked account: ${patUser}` : ""
          }`
        );
        setMessageType("success");
      } else {
        setMessage(`Connection failed: ${data.error || "Unknown error"}`);
        setMessageType("error");
      }
    } catch (err) {
      setMessage("Connection failed: Network error");
      setMessageType("error");
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!parsedProjectUrl) {
      setMessage("Enter a valid Azure DevOps project URL before saving");
      setMessageType("error");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "azure_devops",
          value: { projectUrl: projectUrl.trim(), pat },
        }),
      });

      if (!response.ok) throw new Error("Failed to save settings");
      const data = await response.json().catch(() => null);
      if (data?.value) {
        setProjectUrl(data.value.projectUrl || projectUrl.trim());
        setHasPat(Boolean(data.value.hasPat));
        setPat("");
      }

      toast.success("Settings saved successfully.");
      onClose();
    } catch (err) {
      setMessage("Failed to save settings");
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
              <Label htmlFor="azureProjectUrl">Project URL</Label>
              <Input
                id="azureProjectUrl"
                type="text"
                value={projectUrl}
                onChange={(e) => setProjectUrl(e.target.value)}
                placeholder="https://dev.azure.com/mycompany/MyProject"
                required
              />
              <p className="text-xs text-muted-foreground">
                Paste the Azure DevOps project URL. Organization and project are parsed from this value.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="azureOrganization">Organization</Label>
                <Input
                  id="azureOrganization"
                  type="text"
                  value={organization}
                  readOnly
                  placeholder="Parsed from project URL"
                  className="bg-muted"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="azureProject">Project</Label>
                <Input
                  id="azureProject"
                  type="text"
                  value={project}
                  readOnly
                  placeholder="Parsed from project URL"
                  className="bg-muted"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pat">Azure DevOps authentication</Label>
              <Input
                id="pat"
                type="password"
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                placeholder={hasPat ? "Azure DevOps link saved" : "Enter Azure DevOps PAT"}
                required={!hasPat}
              />
              <p className="text-xs text-muted-foreground">
                {hasPat
                  ? "Leave blank to keep the saved Azure DevOps link for this project."
                  : "Create a token at: User Settings -> Personal access tokens -> New Token."}
              </p>
            </div>

            <div className="flex gap-2 justify-between pt-4">
              <Button
                type="button"
                onClick={handleTest}
                disabled={testing || saving}
                variant="outline"
                className="border-blue-600 text-blue-600 hover:bg-blue-50"
              >
                {testing ? "Testing..." : "Test link"}
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
