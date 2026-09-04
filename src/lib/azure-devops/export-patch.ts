import {
  JsonPatchOperation,
  Operation,
} from "azure-devops-node-api/interfaces/common/VSSInterfaces";

/**
 * Azure DevOps stores the long description of a Bug in Repro Steps. `System.Description`
 * exists on the Bug type, but the work item form never renders it, so a description
 * exported there is invisible in Azure DevOps.
 */
export const AZURE_DEVOPS_DESCRIPTION_FIELD = "System.Description";
export const AZURE_DEVOPS_REPRO_STEPS_FIELD = "Microsoft.VSTS.TCM.ReproSteps";

/** Value of a `/multilineFieldsFormat/<field>` patch operation. */
export const MARKDOWN_FIELD_FORMAT = "Markdown";

export const getDescriptionFieldForWorkItemType = (workItemType: string): string =>
  workItemType.trim().toLowerCase() === "bug"
    ? AZURE_DEVOPS_REPRO_STEPS_FIELD
    : AZURE_DEVOPS_DESCRIPTION_FIELD;

export interface WorkItemCreatePatchInput {
  title: string;
  description?: string | null;
  workItemType: string;
  assignedUserValue?: string | null;
  parentWorkItemId?: number | null;
  organization: string;
}

/**
 * Builds the create patch document for an exported work item. Only the fields listed
 * here ever reach Azure DevOps — internal fields such as work item notes stay local.
 */
export const buildWorkItemCreatePatchDocument = ({
  title,
  description,
  workItemType,
  assignedUserValue,
  parentWorkItemId,
  organization,
}: WorkItemCreatePatchInput): JsonPatchOperation[] => {
  const descriptionField = getDescriptionFieldForWorkItemType(workItemType);
  const patchOperations: JsonPatchOperation[] = [
    {
      op: Operation.Add,
      path: "/fields/System.Title",
      value: title,
    } as JsonPatchOperation,
  ];

  if (description) {
    patchOperations.push({
      op: Operation.Add,
      path: `/fields/${descriptionField}`,
      value: description,
    } as JsonPatchOperation);
    // Descriptions are authored in Markdown. Azure DevOps large text fields default to
    // HTML, so the format has to be declared alongside the value or the Markdown renders
    // as literal text. The switch is one-way: once a field is stored as Markdown, Azure
    // DevOps cannot convert it back to HTML.
    patchOperations.push({
      op: Operation.Add,
      path: `/multilineFieldsFormat/${descriptionField}`,
      value: MARKDOWN_FIELD_FORMAT,
    } as JsonPatchOperation);
  }

  if (assignedUserValue) {
    patchOperations.push({
      op: Operation.Add,
      path: "/fields/System.AssignedTo",
      value: assignedUserValue,
    } as JsonPatchOperation);
  }

  if (parentWorkItemId) {
    patchOperations.push({
      op: Operation.Add,
      path: "/relations/-",
      value: {
        rel: "System.LinkTypes.Hierarchy-Reverse",
        url: `https://dev.azure.com/${organization}/_apis/wit/workItems/${parentWorkItemId}`,
        attributes: {
          comment: "Parent work item",
        },
      },
    } as JsonPatchOperation);
  }

  return patchOperations;
};
