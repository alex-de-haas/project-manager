import { describe, expect, it } from "vitest";
import {
  AZURE_DEVOPS_DESCRIPTION_FIELD,
  AZURE_DEVOPS_REPRO_STEPS_FIELD,
  MARKDOWN_FIELD_FORMAT,
  buildWorkItemCreatePatchDocument,
  getDescriptionFieldForWorkItemType,
} from "@/lib/azure-devops/export-patch";

const paths = (document: ReturnType<typeof buildWorkItemCreatePatchDocument>) =>
  document.map((operation) => operation.path);

const valueAt = (
  document: ReturnType<typeof buildWorkItemCreatePatchDocument>,
  path: string
) => document.find((operation) => operation.path === path)?.value;

describe("getDescriptionFieldForWorkItemType", () => {
  it("routes bugs to Repro Steps", () => {
    expect(getDescriptionFieldForWorkItemType("Bug")).toBe(AZURE_DEVOPS_REPRO_STEPS_FIELD);
    expect(getDescriptionFieldForWorkItemType("bug")).toBe(AZURE_DEVOPS_REPRO_STEPS_FIELD);
  });

  it("routes every other type to Description", () => {
    expect(getDescriptionFieldForWorkItemType("Task")).toBe(AZURE_DEVOPS_DESCRIPTION_FIELD);
    expect(getDescriptionFieldForWorkItemType("User Story")).toBe(
      AZURE_DEVOPS_DESCRIPTION_FIELD
    );
  });
});

describe("buildWorkItemCreatePatchDocument", () => {
  const base = {
    title: "Fix the thing",
    workItemType: "Task",
    organization: "contoso",
  };

  it("writes a task description to System.Description as Markdown", () => {
    const document = buildWorkItemCreatePatchDocument({
      ...base,
      description: "## Steps\n\n- one\n- two",
    });

    expect(valueAt(document, `/fields/${AZURE_DEVOPS_DESCRIPTION_FIELD}`)).toBe(
      "## Steps\n\n- one\n- two"
    );
    expect(valueAt(document, `/multilineFieldsFormat/${AZURE_DEVOPS_DESCRIPTION_FIELD}`)).toBe(
      MARKDOWN_FIELD_FORMAT
    );
  });

  it("writes a bug description to Repro Steps as Markdown", () => {
    const document = buildWorkItemCreatePatchDocument({
      ...base,
      workItemType: "Bug",
      description: "**Repro**",
    });

    expect(valueAt(document, `/fields/${AZURE_DEVOPS_REPRO_STEPS_FIELD}`)).toBe("**Repro**");
    expect(valueAt(document, `/multilineFieldsFormat/${AZURE_DEVOPS_REPRO_STEPS_FIELD}`)).toBe(
      MARKDOWN_FIELD_FORMAT
    );
    expect(paths(document)).not.toContain(`/fields/${AZURE_DEVOPS_DESCRIPTION_FIELD}`);
  });

  it("omits the description and its format when there is no description", () => {
    const document = buildWorkItemCreatePatchDocument({ ...base, description: null });

    expect(paths(document)).toEqual(["/fields/System.Title"]);
  });

  it("adds the assignee and the parent link when provided", () => {
    const document = buildWorkItemCreatePatchDocument({
      ...base,
      assignedUserValue: "dev@contoso.com",
      parentWorkItemId: 42,
    });

    expect(valueAt(document, "/fields/System.AssignedTo")).toBe("dev@contoso.com");
    expect(valueAt(document, "/relations/-")).toMatchObject({
      rel: "System.LinkTypes.Hierarchy-Reverse",
      url: "https://dev.azure.com/contoso/_apis/wit/workItems/42",
    });
  });

  it("never sends internal notes", () => {
    const document = buildWorkItemCreatePatchDocument({
      ...base,
      description: "Public description",
      // @ts-expect-error notes are not part of the export contract
      notes: "Internal note that must stay local",
    });

    const serialized = JSON.stringify(document);
    expect(serialized).not.toContain("Internal note");
    expect(paths(document).some((path) => path?.toLowerCase().includes("note"))).toBe(false);
  });
});
