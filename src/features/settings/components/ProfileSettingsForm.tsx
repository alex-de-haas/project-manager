"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AzureDevOpsPublicSettings {
  organization?: string;
  project?: string;
  hasPat?: boolean;
}

export function ProfileSettingsForm() {
  const [organization, setOrganization] = useState("");
  const [project, setProject] = useState("");
  const [pat, setPat] = useState("");
  const [hasPat, setHasPat] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");

  const azureProjectUrl = useMemo(() => {
    const trimmedOrganization = organization.trim();
    const trimmedProject = project.trim();
    if (!trimmedOrganization || !trimmedProject) return "";
    return `https://dev.azure.com/${encodeURIComponent(trimmedOrganization)}/${encodeURIComponent(trimmedProject)}`;
  }, [organization, project]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/settings?key=azure_devops");
      if (response.ok) {
        const data = await response.json();
        const value = data.value as AzureDevOpsPublicSettings | undefined;
        setOrganization(value?.organization || "");
        setProject(value?.project || "");
        setHasPat(Boolean(value?.hasPat));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  const handleSavePat = async () => {
    if (!pat.trim()) {
      setMessage("Enter a personal Azure DevOps PAT before saving.");
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
          value: { pat },
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save Azure DevOps PAT.");
      }

      setPat("");
      setHasPat(true);
      setMessage("Azure DevOps personal PAT saved.");
      setMessageType("success");
    } catch {
      setMessage("Failed to save Azure DevOps PAT.");
      setMessageType("error");
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!pat.trim() && !hasPat) {
      setMessage("Save or enter a personal Azure DevOps PAT before testing.");
      setMessageType("error");
      return;
    }

    setTesting(true);
    setMessage("");
    try {
      const response = await fetch("/api/azure-devops/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.details || "Connection failed.");
      }

      setMessage(`Connection successful. Found project: ${data.project.name}`);
      setMessageType("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection failed.");
      setMessageType("error");
    } finally {
      setTesting(false);
    }
  };

  const handleDeletePat = async () => {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/settings?key=azure_devops&credential=pat", {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to remove Azure DevOps PAT.");
      }

      setPat("");
      setHasPat(false);
      setMessage("Azure DevOps personal PAT removed.");
      setMessageType("success");
    } catch {
      setMessage("Failed to remove Azure DevOps PAT.");
      setMessageType("error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading profile...</div>;
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Azure DevOps Project</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input value={organization || "Not configured"} disabled />
          <Input value={project || "Not configured"} disabled />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="profilePat">Personal Access Token (PAT)</Label>
        <Input
          id="profilePat"
          type="password"
          value={pat}
          onChange={(event) => setPat(event.target.value)}
          placeholder={hasPat ? "Personal PAT saved" : "Enter your Azure DevOps PAT"}
        />
        <p className="text-xs text-muted-foreground">
          {hasPat ? "Leave blank to keep the saved personal PAT." : "Used only for your Azure DevOps actions."}
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" onClick={handleSavePat} disabled={saving || testing}>
          {saving ? "Saving..." : "Save PAT"}
        </Button>
        <Button
          type="button"
          onClick={handleTestConnection}
          disabled={saving || testing || (!pat && !hasPat)}
          variant="outline"
        >
          {testing ? "Testing..." : "Test Connection"}
        </Button>
        <Button
          type="button"
          onClick={handleDeletePat}
          disabled={saving || testing || !hasPat}
          variant="outline"
        >
          Remove PAT
        </Button>
        {azureProjectUrl ? (
          <Button asChild variant="outline">
            <a href={azureProjectUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              Open Project
            </a>
          </Button>
        ) : null}
      </div>

      {message ? (
        <Alert
          variant={messageType === "success" ? "default" : "destructive"}
          className={
            messageType === "success"
              ? "border-green-300 bg-green-50 text-green-950 dark:border-green-800 dark:bg-green-950/40 dark:text-green-100"
              : undefined
          }
        >
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
