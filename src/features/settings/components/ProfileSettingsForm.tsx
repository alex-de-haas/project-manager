"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface AzureDevOpsPublicSettings {
  organization?: string;
  project?: string;
  projectUrl?: string;
  hasPat?: boolean;
  identity?: AzureDevOpsPublicIdentity | null;
}

interface AzureDevOpsPublicIdentity {
  displayName?: string | null;
  email?: string | null;
}

interface ApiError {
  error?: string;
}

interface JsonImportResponse {
  imported?: {
    timeEntries?: number;
    dayOffs?: number;
    tasksCreated?: number;
    tasksMatched?: number;
  };
}

const formatAzureDevOpsIdentity = (identity?: AzureDevOpsPublicIdentity | null) => {
  const displayName = identity?.displayName?.trim();
  const email = identity?.email?.trim();
  return displayName || email || "";
};

interface ProfileSettingsFormProps {
  disabled?: boolean;
  disabledMessage?: string;
}

export function ProfileSettingsForm({
  disabled = false,
  disabledMessage = "Select or create a project before editing profile settings.",
}: ProfileSettingsFormProps) {
  const [organization, setOrganization] = useState("");
  const [project, setProject] = useState("");
  const [defaultDayLength, setDefaultDayLength] = useState("");
  const [jsonImportFile, setJsonImportFile] = useState<File | null>(null);
  const [jsonImportInputKey, setJsonImportInputKey] = useState(0);
  const [pat, setPat] = useState("");
  const [hasPat, setHasPat] = useState(false);
  const [azureDevOpsIdentity, setAzureDevOpsIdentity] =
    useState<AzureDevOpsPublicIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingDayLength, setSavingDayLength] = useState(false);
  const [importingJson, setImportingJson] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");

  const loadSettings = async () => {
    if (disabled) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [azureResponse, dayLengthResponse] = await Promise.all([
        fetch("/api/settings?key=azure_devops"),
        fetch("/api/settings?key=default_day_length"),
      ]);
      if (azureResponse.ok) {
        const data = await azureResponse.json();
        const value = data.value as AzureDevOpsPublicSettings | undefined;
        const nextOrganization = value?.organization || "";
        const nextProject = value?.project || "";
        setOrganization(nextOrganization);
        setProject(nextProject);
        setHasPat(Boolean(value?.hasPat));
        setAzureDevOpsIdentity(value?.hasPat ? value.identity ?? null : null);
      } else {
        setOrganization("");
        setProject("");
        setHasPat(false);
        setAzureDevOpsIdentity(null);
      }
      if (dayLengthResponse.ok) {
        const data = await dayLengthResponse.json();
        setDefaultDayLength(String(data.value ?? ""));
      } else {
        setDefaultDayLength("");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
    // loadSettings is intentionally run when the project-scoped disabled state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  useEffect(() => {
    if (!message) return;

    if (messageType === "success") {
      toast.success(message);
    } else {
      toast.error(message);
    }

    setMessage("");
  }, [message, messageType]);

  const handleSaveDefaultDayLength = async () => {
    const dayLengthNum = Number(defaultDayLength);
    if (!Number.isFinite(dayLengthNum) || dayLengthNum < 0.5 || dayLengthNum > 24) {
      setMessage("Default day length must be between 0.5 and 24 hours.");
      setMessageType("error");
      return;
    }

    setSavingDayLength(true);
    setMessage("");
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "default_day_length",
          value: String(dayLengthNum),
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Failed to save default day length.");
      }

      setDefaultDayLength(String(dayLengthNum));
      setMessage("Default day length saved.");
      setMessageType("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save default day length.");
      setMessageType("error");
    } finally {
      setSavingDayLength(false);
    }
  };

  const handleImportJson = async () => {
    if (!jsonImportFile) {
      setMessage("Please select a JSON import file.");
      setMessageType("error");
      return;
    }

    setImportingJson(true);
    setMessage("");

    try {
      const parsed = JSON.parse(await jsonImportFile.text());
      const response = await fetch("/api/json-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = (await response.json().catch(() => ({}))) as ApiError & JsonImportResponse;

      if (!response.ok) {
        throw new Error(data.error || "Failed to import JSON data.");
      }

      const imported = data.imported ?? {};
      setJsonImportFile(null);
      setJsonImportInputKey((value) => value + 1);
      setMessage(
        `JSON import completed: ${imported.timeEntries ?? 0} time entries, ${
          imported.dayOffs ?? 0
        } days off, ${imported.tasksCreated ?? 0} tasks created, ${
          imported.tasksMatched ?? 0
        } tasks matched.`
      );
      setMessageType("success");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to import JSON data.";
      setMessage(errorMessage);
      setMessageType("error");
    } finally {
      setImportingJson(false);
    }
  };

  const handleSavePat = async () => {
    if (!pat.trim()) {
      setMessage("Enter the Azure DevOps authentication token before saving this project link.");
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
        throw new Error("Failed to save Azure DevOps account link.");
      }

      const data = (await response.json().catch(() => ({}))) as {
        value?: AzureDevOpsPublicSettings;
      };
      const savedIdentity = data.value?.identity ?? null;
      setPat("");
      setHasPat(Boolean(data.value?.hasPat ?? true));
      setAzureDevOpsIdentity(savedIdentity);
      const savedAs = formatAzureDevOpsIdentity(savedIdentity);
      setMessage(
        savedAs
          ? `Azure DevOps account linked for this project as ${savedAs}.`
          : "Azure DevOps account link saved for this project. Identity is not resolved yet."
      );
      setMessageType("success");
    } catch {
      setMessage("Failed to save Azure DevOps account link.");
      setMessageType("error");
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!organization || !project) {
      setMessage("Azure DevOps is not configured for the active project.");
      setMessageType("error");
      return;
    }
    if (!pat.trim() && !hasPat) {
      setMessage("Save or enter the Azure DevOps authentication token before testing this project link.");
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

      const testedIdentity = data.authenticatedUser
        ? {
            displayName: data.authenticatedUser.displayName ?? null,
            email: data.authenticatedUser.uniqueName ?? null,
          }
        : null;
      if (!pat.trim() && testedIdentity) {
        setAzureDevOpsIdentity(testedIdentity);
      }

      const patUser =
        data.authenticatedUser?.displayName || data.authenticatedUser?.uniqueName;
      setMessage(
        `Connection successful. Found project: ${data.project.name}${
          patUser ? `. Linked account: ${patUser}` : ""
        }`
      );
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
        throw new Error("Failed to remove Azure DevOps account link.");
      }

      setPat("");
      setHasPat(false);
      setAzureDevOpsIdentity(null);
      setMessage("Azure DevOps account link removed for this project.");
      setMessageType("success");
    } catch {
      setMessage("Failed to remove Azure DevOps account link.");
      setMessageType("error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading profile...</div>;
  }

  if (disabled) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        {disabledMessage}
      </div>
    );
  }

  const azureDevOpsConfigured = Boolean(organization && project);
  const connectedIdentityName = formatAzureDevOpsIdentity(azureDevOpsIdentity);
  const connectedIdentityEmail = azureDevOpsIdentity?.email?.trim() || "";

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-md border p-4">
        <div className="space-y-1">
          <Label htmlFor="profileDefaultDayLength">Work schedule</Label>
          <p className="text-xs text-muted-foreground">
            Set your standard work day for the active project.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="profileDefaultDayLength"
            type="number"
            min="0.5"
            max="24"
            step="0.5"
            value={defaultDayLength}
            onChange={(event) => setDefaultDayLength(event.target.value)}
            placeholder="e.g., 4 or 8"
          />
          <Button
            type="button"
            onClick={handleSaveDefaultDayLength}
            disabled={savingDayLength || saving || testing}
          >
            {savingDayLength ? "Saving..." : "Save day length"}
          </Button>
        </div>
      </div>

      <div className="space-y-3 rounded-md border p-4">
        <div className="space-y-1">
          <Label htmlFor="profileJsonImportFile">JSON Data Import</Label>
          <p className="text-xs text-muted-foreground">
            Import Project Manager migration data into your current active project.
          </p>
        </div>
        <div className="space-y-2">
          <Input
            key={jsonImportInputKey}
            id="profileJsonImportFile"
            type="file"
            accept="application/json,.json"
            onChange={(event) => setJsonImportFile(event.target.files?.[0] ?? null)}
            disabled={importingJson || saving || savingDayLength || testing}
          />
          <p className="text-xs text-muted-foreground">
            Time entries are matched by Azure DevOps work item ID. Missing work items are created as local Azure DevOps-linked tasks for you in the active project.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={handleImportJson}
          disabled={!jsonImportFile || importingJson || saving || savingDayLength || testing}
        >
          {importingJson ? "Importing..." : "Import JSON"}
        </Button>
      </div>

      <div className="space-y-3 rounded-md border p-4">
        <div className="space-y-1">
          <Label>External account</Label>
          <p className="text-xs text-muted-foreground">
            Link your user to the external system configured for the active project.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Provider
            </p>
            <p className="mt-1 truncate text-sm font-medium">
              Azure DevOps
            </p>
          </div>
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              External project
            </p>
            <p className="mt-1 truncate text-sm font-medium">
              {organization && project ? `${organization} / ${project}` : "Not configured"}
            </p>
          </div>
        </div>

        <div className="space-y-2 border-t pt-3">
          <Label htmlFor="profilePat">Azure DevOps authentication</Label>
          <Input
            id="profilePat"
            type="password"
            value={pat}
            onChange={(event) => setPat(event.target.value)}
            placeholder={hasPat ? "Azure DevOps link saved" : "Enter Azure DevOps PAT"}
          />
          <p className="text-xs text-muted-foreground">
            {hasPat
              ? "Leave blank to keep the saved Azure DevOps link for this project."
              : "Used only to connect your current user to Azure DevOps for this project."}
          </p>
          {hasPat ? (
            <div className="rounded-md border bg-muted/40 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Linked Azure DevOps account
              </p>
              {connectedIdentityName ? (
                <div className="mt-1 space-y-0.5">
                  <p className="truncate text-sm font-medium text-foreground">
                    {connectedIdentityName}
                  </p>
                  {connectedIdentityEmail && connectedIdentityEmail !== connectedIdentityName ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {connectedIdentityEmail}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  Identity has not been resolved yet. Save or test the saved link to update it.
                </p>
              )}
            </div>
          ) : null}
          <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
            Azure DevOps currently links accounts with a project-scoped user token. Create it in Azure DevOps under User settings, Personal access tokens, New Token. Future external providers can use their own account-linking method.
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" onClick={handleSavePat} disabled={saving || testing}>
            {saving ? "Saving..." : "Save link"}
          </Button>
          <Button
            type="button"
            onClick={handleTestConnection}
            disabled={saving || testing || !azureDevOpsConfigured || (!pat && !hasPat)}
            variant="outline"
          >
            {testing ? "Testing..." : "Test link"}
          </Button>
          <Button
            type="button"
            onClick={handleDeletePat}
            disabled={saving || testing || !hasPat}
            variant="outline"
          >
            Remove link
          </Button>
        </div>
      </div>

    </div>
  );
}
