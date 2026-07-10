# Work Item Automation Rules

Status: Idea
Created: 2026-07-10
Updated: 2026-07-10

## Motivation

Project Manager currently performs several hardcoded side effects when a work item changes
status. Teams need project-specific automation that can react to work item events, evaluate
typed conditions, and execute one or more ordered actions.

A representative workflow is:

- A developer changes a Bug from Active to Resolved.
- Project Manager assigns the Bug to a selected QA user.
- Project Manager optionally adds the Bug to the QA user's Time Management list.
- Project Manager creates or updates a provider comment containing the developer's tracked
  time for the event month, for example `14.50 h (July 2026)`.

Rules must be configurable without arbitrary code execution, remain provider-aware without
coupling the core domain to Azure DevOps, and expose partial failures instead of hiding them.

## Current Context and Existing-Feature Conflicts

- Project Manager stores normalized work item types and statuses. Rules should use
  `user_story`, `task`, and `bug`, and `new`, `in_progress`, `resolved`, and `completed`,
  rather than provider-native names.
- Local workflow gates must run before automation. A rejected status transition must not
  emit an automation event.
- Status changes currently enter through several API paths. Time Management uses the shared
  local workflow-gate function, while Release Planning child and release work item routes
  perform their own provider-first updates. A rule engine requires a single status-change
  command or a shared event-emission boundary; otherwise rules may be missed or executed
  twice.
- Provider refresh and import update work items directly and can bypass local workflow
  gates. Treating every database status change as an automation event would therefore
  change existing behavior and could create loops.
- The Time Management Azure DevOps status route already writes tracked time to the provider
  `CompletedWork` field for completed Tasks and resolved Bugs. The written value sums only
  the requesting user's time entries for the work item, not all users. This behavior must
  remain explicit, must not regress, and must not be duplicated by a configurable rule.
- Work item assignment and Time Management membership are separate relationships.
  Assigning a work item to QA does not automatically add it to the QA user's Time
  Management list.
- Azure DevOps assignment requires a linked provider identity for the target Project Manager
  user. Provider actions currently use the triggering user's project-scoped credential.
- Project Manager has no local work item comment model. Existing comments belong to
  blockers, not to the work item discussion. An initial work item comment action therefore
  needs a linked provider that supports creating and updating comments.
- Settings already distinguishes personal Profile settings from administrator-only,
  project-scoped configuration. Team automation fits the latter scope.

## Scope of Exploration

This idea explores:

- Project-scoped rules managed from a separate Settings tab.
- An initial `work_item.status_changed` trigger.
- Typed conditions over normalized work item and event data.
- Multiple ordered actions in one rule.
- Assignment to an explicitly selected project member.
- Explicit Time Management membership changes.
- Provider comment creation and idempotent update.
- Safe template parameters for generated content.
- Deterministic ordering, conflict handling, audit history, and retries.
- Provider-neutral rule definitions with provider-specific capability adapters.

The initial design should not allow arbitrary JavaScript, shell commands, SQL, unrestricted
HTTP requests, cross-project mutations, or status-changing actions. These capabilities would
introduce security, permission, and recursion risks before the basic execution model is
proven.

## Possible Approaches

### Approach A: Workflow-Specific Settings

Add dedicated settings such as "Assign resolved Bugs to QA" and "Post monthly time comment."

Pros:

- Small initial implementation.
- Simple UI for one known workflow.

Cons:

- Every new trigger or action requires new schema, API, UI, and execution code.
- Multiple actions, ordering, reusable templates, and audit history become difficult.
- Hardcoded settings recreate the limitation this idea is intended to remove.

### Approach B: Typed Declarative Rule Engine

Represent each rule as a typed trigger, a condition tree, and an ordered list of typed
actions. Each trigger, condition field, operator, action, and template variable has a
validated schema.

Pros:

- Supports multiple workflows without arbitrary code.
- Provides deterministic validation, execution, previews, and audit records.
- Can remain provider-neutral through capability adapters.
- Can grow incrementally by adding new trigger and action types.

Cons:

- Requires an execution model, idempotency, retries, and conflict handling.
- The rule-builder UI is more involved than a dedicated checkbox.

### Approach C: Scripts or Arbitrary Webhooks

Allow administrators to enter JavaScript, shell commands, or unrestricted HTTP calls.

Pros:

- Maximum theoretical flexibility.

Cons:

- Creates substantial security, permission, secret-management, and support risks.
- Makes execution non-deterministic and difficult to validate or preview.
- Is not appropriate for an initial automation system.

## Current Recommendation

Use Approach B: a project-scoped, typed declarative rule engine.

The first version should support one trigger (`work_item.status_changed`), a focused condition
catalog, and a small action catalog. The internal model should allow additional event and
action types without changing existing rule records.

Rules should initially run only for user-initiated local status transitions. Event origin,
correlation, and causation metadata should exist from the start so provider refreshes, API
changes, and automation-caused events can be considered later without introducing loops.

Do not support arbitrary scripts, expressions, SQL, or HTTP requests.

## Prerequisites (Phase 0)

The engine depends on groundwork that is substantial on its own and should be planned,
implemented, and verified before the first rule executes — possibly as a separate planning
document:

- **A single status-change boundary.** Release Planning child and release work item routes
  currently perform provider-first updates with their own status normalization and never
  invoke the shared workflow-gate function. Until every status write flows through one
  command that applies gates and emits events, rules would be silently skipped on some
  surfaces and duplicated on others.
- **Compatibility tests before the refactor.** The repository currently has no automated
  coverage for workflow gates, status synchronization, assignment, Time Management
  visibility, or `CompletedWork`. These tests must exist before the status paths are
  unified, not alongside the rule engine.
- **A monotonic work item revision.** Work items have no revision or compare-and-swap
  mechanism, so concurrent status requests could create two events from stale state.
- **Project timezone and locale settings.** Period boundaries, artifact keys, and rendered
  month names depend on a stable project timezone that does not exist in the domain model
  yet.

## Proposed Product Shape

Add an administrator-only **Automation** tab to Settings for the active project.

The tab should provide:

- A list of rules with name, enabled state, priority, trigger summary, action count, and last
  execution result.
- Create, edit, duplicate, enable, disable, and delete operations.
- A builder with Trigger, Conditions, Actions, and Execution sections.
- Explicit up/down controls for action ordering. Drag-and-drop is unnecessary for the small
  initial action lists.
- A project-member selector for assignment and Time Management actions.
- Provider-link health next to users selected for provider-synchronized assignment, and
  equally visible credential health for potential triggering actors: rules run with the
  actor's credential, so a project member without a stored PAT fails every provider action
  they trigger.
- A template variable picker and rendered preview.
- A dry run against a selected work item that shows matching conditions, resolved parameters,
  intended actions, conflicts, and validation errors without mutating data.
- Per-rule execution history with per-action results and retry state.

Rules should initially be project-scoped and manageable only by Hosty administrators.
Personal rules and shared rule templates can be considered later.

## Rule Structure

A rule contains:

- A stable rule identifier and schema version.
- Project scope.
- Name and optional description.
- Enabled state.
- Explicit priority.
- One typed trigger.
- An optional typed condition tree.
- One or more ordered typed actions.
- A default failure policy.
- Creation and update audit fields.

Conceptual example:

```yaml
name: Hand resolved bugs to QA
enabled: true
priority: 100

trigger:
  type: work_item.status_changed
  origins:
    - local_user

conditions:
  all:
    - field: work_item.type
      operator: equals
      value: bug
    - field: status.to
      operator: equals
      value: resolved
    - field: work_item.has_linked_provider
      operator: equals
      value: true

actions:
  - key: assign-qa
    order: 10
    type: work_item.assign
    target:
      kind: project_user
      userId: 42
    providerSync: required
    onFailure: stop

  - key: add-to-qa-time-management
    order: 20
    type: time_management.ensure_membership
    target:
      kind: action_target
      actionKey: assign-qa
    onFailure: continue

  - key: monthly-time-comment
    order: 30
    type: provider.comment.upsert
    destination: linked_provider
    timeScope: previous_assignee
    period: event_month
    artifactScope: work_item_period
    template: "{{ time.total_hours | number(2) }} h ({{ period.month_name }} {{ period.year }})"
    onFailure: continue
```

The exact serialized format is an implementation detail. The API should expose typed
structures rather than accept arbitrary JSON with unvalidated fields.

## Trigger Model

The first trigger should be `work_item.status_changed`. The event must be emitted only when
the normalized status actually changes.

Its immutable snapshot should include:

- Event ID and occurrence time.
- Project ID.
- Origin: `local_user`, `provider_refresh`, `import`, `automation`, or `api`.
- Actor user ID and display snapshot when an actor exists.
- Correlation and causation IDs.
- Work item identity, type, title, and provider link snapshot.
- Previous and next status.
- Previous and next assignee.
- Work item revision or update timestamp.
- Relevant project timezone and locale.

Conditions and templates should read this immutable snapshot. Their meaning must not change
because an earlier action mutates the work item.

The snapshot freezes identities and parameters, not derived aggregates. Time aggregation
runs against the database when an action executes, using frozen snapshot parameters such as
the previous assignee, the event month, and the project timezone. This is safe because
reassignment does not delete historical time entries.

The first version emits and executes rules only for `local_user` origins. The origin filter
remains part of the trigger schema, but the engine enforces it and the rule editor does not
expose it until other origins become executable.

Potential later triggers include `time_entry.changed`, `work_item.assignee_changed`, and
explicit provider-refresh events. They should not be enabled implicitly by the first status
trigger.

## Condition Model

Conditions should support nested `all`, `any`, and `not` groups with a bounded nesting depth.
The first UI may expose only a flat `all` group while keeping the typed model extensible.

Candidate fields include:

- `work_item.type`
- `work_item.status`
- `status.from`
- `status.to`
- `work_item.assigned_user_id`
- `work_item.has_linked_provider`
- `work_item.provider`
- `work_item.tags`
- `actor.user_id`
- `event.origin`

`time.total_hours` is intentionally not a first-version condition field. Time aggregation is
defined by action configuration — user scope, period, and timezone — and a bare condition
field has no defined aggregation scope. A time-based condition needs those parameters
specified before it can join the catalog.

Candidate typed operators include:

- `equals`
- `not_equals`
- `in`
- `not_in`
- `contains`
- `exists`
- Numeric comparison operators for numeric fields.

The UI must only offer operators valid for the selected field type.

## Initial Action Catalog

### `work_item.assign`

Assign the canonical work item to a selected project member.

Configuration should specify whether provider synchronization is:

- `required`
- `best_effort`
- `local_only`

For a linked provider and `required` synchronization, the provider assignment should succeed
before the local assignment is finalized. This matches the existing Release Planning child
assignment contract and prevents a misleading local QA handoff when Azure DevOps rejected it.

The target user must still belong to the project and, when provider synchronization is
required, must have a provider identity for that project. A rule that references a removed
member or missing provider identity should be shown as invalid rather than silently choosing
another user.

Project Manager currently has no QA role. The initial action therefore selects a concrete
project user; role-based or group-based targets are a separate future idea.

### `time_management.ensure_membership`

Ensure that the work item exists in a selected user's Time Management list.

This must remain separate from assignment. Some teams want ownership without automatically
adding an item to the assignee's personal Time Management list, while QA handoff workflows
may want both actions.

### `provider.comment.upsert`

Create or update one automation-owned provider comment using a stable artifact identity.
The action must never fuzzy-match or overwrite an unrelated human comment.

### Future Actions

Potential future actions include:

- Append-only `provider.comment.add`. The upsert action covers the motivating workflow, and
  a second, similar comment action doubles UI and documentation surface without adding a
  needed capability.
- Set or clear tags.
- Set a provider field such as `CompletedWork`.
- Add a checklist item.
- Create a notification.
- Invoke a restricted, separately approved integration action.

Status-changing actions require recursion controls and should not be part of the first
version.

## Parameters and Templates

Templates must use a small allowlisted syntax and must never evaluate JavaScript or arbitrary
expressions.

Candidate variables include:

- `project.id`
- `project.name`
- `work_item.id`
- `work_item.external_id`
- `work_item.title`
- `work_item.type`
- `status.from`
- `status.to`
- `actor.id`
- `actor.display_name`
- `assignee.before.id`
- `assignee.before.display_name`
- `assignee.after.id`
- `assignee.after.display_name`
- `event.occurred_at`
- `period.key`
- `period.month`
- `period.month_name`
- `period.year`
- `period.start`
- `period.end`
- `time.total_hours`

Candidate safe filters include:

- Number formatting with bounded precision.
- Date formatting.
- Uppercase and lowercase.
- A default value for optional fields.

Templates should be validated when a rule is saved and again when it runs. Unknown required
variables should fail instead of silently becoming empty strings. Output must be escaped or
sanitized for the destination provider and checked against provider length limits.

Time aggregation is action configuration, not template code. For example:

- Work item: triggering work item.
- User scope: triggering actor, previous assignee, selected user, or all users.
- Period: event month.
- Timezone: project timezone.
- Aggregation: sum of time entries.

## Monthly Time Comment Upsert

A generated comment must be identified independently of its rendered text. Fuzzy matching
against human-readable text could modify an unrelated manual comment.

Recommended artifact identity:

```text
provider + rule_id + action_id + work_item_id + period_key
```

For example, resolving the same Bug twice in July 2026 must target the same artifact for
period key `2026-07`.

Store a local artifact record containing:

- Rule and action identifiers.
- Work item and provider.
- Period key.
- External comment ID.
- Marker value when the provider preserves one.
- Last rendered content hash.
- Last provider revision when available.

The upsert algorithm should:

1. Resolve the stable artifact identity.
2. Fetch the mapped external comment when an external comment ID exists and compare its
   current content with the last rendered content hash.
3. Update it only when it is still automation-owned and has not been changed manually.
4. When the mapping is missing, search only for an exact automation marker if the provider
   preserves such markers.
5. Adopt one exact match or create a new comment when no exact match exists.
6. Fail safely rather than guess when multiple exact matches exist.
7. Recreate and remap the comment when the previously managed comment was deleted.
8. Never update an unmarked manual comment because its visible text happens to be similar.

The generated comment is automation-managed, but the safe default is to report a conflict
instead of overwriting a manual edit. A later explicit conflict policy could allow replacement
when a team intentionally treats the entire comment as generated content.

A status-only trigger produces a comment snapshot. Keeping the comment synchronized after a
later time-entry edit would require a separate `time_entry.changed` rule or an explicit rerun
using the same artifact identity.

## Ordering, Failure, and Atomicity

The primary local status transition and creation of a durable automation event should be
committed in one SQLite transaction after workflow gates pass.

Recommended execution flow:

1. Validate the requested transition.
2. Commit the local status and a durable event atomically.
3. Attempt the existing primary provider status synchronization.
4. Match enabled rule versions against the immutable event snapshot.
5. Preflight the matching rules, action capabilities, target users, provider links,
   credentials, templates, and conflicts before the first automation mutation.
6. Execute matching rules by explicit priority with a stable identifier as a tie-breaker.
7. Execute each rule's actions by explicit order.
8. Persist each rule and action result.
9. Retry transient failures using the same rule-version snapshot and idempotency keys.

A provider call and a local SQLite transaction cannot be globally atomic. The UI and
documentation must not promise all-or-nothing execution across external systems.

Recommended default semantics:

- A failed automation action does not roll back the accepted status transition.
- `onFailure: stop` prevents later actions in the same rule from starting.
- `onFailure: continue` records the failure and attempts later actions.
- Completed actions are not automatically compensated or rolled back.
- A rule run can finish as `succeeded`, `partially_succeeded`, `failed`, or `skipped`.
- An action with an uncertain provider result, such as a lost response after a remote write,
  must be recorded as `unknown_outcome` and reconciled before it is retried.
- Transient failures may be retried; validation, permission, and unsupported-capability
  errors require user intervention.
- Automation failure is stored separately from provider synchronization state, although a
  failed provider mutation may also mark the provider link as `sync_failed`.
- When the primary provider status synchronization in step 3 fails, rule matching and
  local-only actions still run, but provider-mutating actions on the same linked work item
  must not execute against the stale provider state. They fail preflight with an explicit
  provider-not-synchronized reason and follow the normal retry path.
- Provider field changes for one work item should be coalesced into one provider update when
  the adapter supports it. Comments remain separate operations.

A practical implementation could persist the event first, attempt it immediately for fast
UI feedback, and leave any unfinished event for a durable worker to resume. The credential
and authorization model for unattended retries remains an open question.

## Multiple Matching Rules and Conflicts

Rules and actions must always have deterministic ordering.

Actions such as assignment write an exclusive property. If multiple matching rules attempt
to assign different users, the engine must not silently alternate ownership.

Recommended initial policy:

- Higher-priority matching rules execute first.
- Exclusive targets are claimed at preflight from match results: the highest-priority
  matching rule that configures an exclusive property, such as assignment, owns it.
- Lower-priority actions targeting the same exclusive property are skipped as superseded and
  shown in the execution log, even when the claiming action later fails. A transient
  provider error must not change the ownership decision by falling through to a different
  assignee; the failed claim is retried instead.
- The editor and dry-run preview warn when enabled rules can overlap.
- Non-exclusive actions, such as comments with different artifact identities, may coexist.

## Conceptual Persistence Model

Rules should use dedicated project-scoped tables rather than the generic per-user Settings
key-value table. Dedicated records are needed for ordering, referential integrity, audit
history, execution diagnostics, and managed provider artifacts.

Candidate records are:

- `automation_rules`: project, name, enabled state, priority, trigger type, validated trigger
  configuration, validated condition tree, schema version, and audit fields.
- `automation_rule_actions`: rule, stable action key, order, action type, validated action
  configuration, direct foreign keys for referenced users where applicable, failure policy,
  and audit fields.
- `automation_events`: immutable event envelope, origin, correlation and causation IDs,
  work item revision, and processing state.
- `automation_rule_runs`: event, a denormalized snapshot of the matched rule configuration
  (no separate rule-version table is required), match result, overall status, attempt count,
  timestamps, and summarized error.
- `automation_action_runs`: rule run, action version, idempotency key, status, attempts,
  resolved non-secret inputs, result metadata, and sanitized error.
- `automation_managed_artifacts`: rule action, work item, provider, artifact scope such as
  `2026-07`, external artifact ID, marker, and content hash.

Configuration may use versioned JSON inside these typed records for extensibility, but every
shape must be validated by the application. Persisted action runs must not contain raw
provider credentials or other secrets.

User foreign keys in `automation_rule_actions` should use `ON DELETE RESTRICT`. Removing a
member from a project does not delete the user row, so the common departure case is handled
by rule validation, which already marks the rule invalid. Deleting a user account entirely
should require explicitly disabling or reconfiguring the rules that reference it, rather
than nulling the target and losing the diagnostic context.

The canonical work item also needs a monotonic revision, or an equivalent compare-and-swap
mechanism, so concurrent status requests cannot create two events from stale state.

## Example Execution

Given:

- A Bug is assigned to Developer A.
- Developer A has 14.5 hours recorded on the Bug during July 2026.
- The Bug is linked to Azure DevOps.
- QA User is a project member with a linked Azure DevOps identity.
- The rule uses `timeScope: previous_assignee` and `period: event_month`.

When Developer A changes the Bug from `in_progress` to `resolved`:

1. Existing workflow gates validate the transition.
2. The local status becomes `resolved`, and the event snapshot records Developer A as the
   actor and previous assignee.
3. Existing provider status and `CompletedWork` synchronization is attempted.
4. The rule matches type `bug` and target status `resolved`.
5. The assignment action assigns the Bug to QA User locally and in Azure DevOps according to
   its provider-sync policy.
6. The membership action ensures that the Bug appears in QA User's Time Management list.
7. The comment action queries Developer A's July time entries using the frozen snapshot
   parameters (previous assignee, event month, project timezone), renders
   `14.50 h (July 2026)`, and creates or updates the automation-owned July comment.
8. The run records the result of all actions.

If the Bug is reopened and resolved again during July, the same monthly comment is updated
instead of duplicated.

## Risks

- A transition rejected by checklist or blocker gates must run no rules.
- Setting the current status again must not emit a new event.
- Provider refresh, import, and automation-originated changes may cause duplicate behavior
  unless event origin is explicit.
- Distributed status update paths may omit rules or bypass existing workflow gates until
  they share a command or event boundary.
- A rule target may leave the project or lose its provider link after the rule is enabled.
- The triggering user's provider credential may be absent, expired, or lack
  assignment/comment permission. PATs are stored per user from Profile settings, so the most
  common first-version failure is expected to be a triggering user without a stored PAT.
- Provider synchronization may be disabled while a rule remains enabled.
- Provider status, assignment, and comment operations may partially succeed and cannot be
  rolled back by SQLite.
- A provider may apply a mutation even when the response is lost, leaving an unknown outcome
  that must be reconciled before retry.
- Azure DevOps process rules may also reassign an item after a state change, conflicting with
  the configured assignment action.
- Concurrent status changes require a work item revision check and unique event IDs.
- Event redelivery and retries must not duplicate assignments, memberships, or comments.
- A work item may be resolved more than once in the same month.
- A generated comment may be edited or deleted directly in the provider.
- Multiple exact automation markers indicate corruption or manual duplication and must not
  be resolved by guessing.
- Time entries may be changed after the status transition, leaving a snapshot comment stale.
- A work item may contain time from multiple users or multiple months.
- A resolved work item may never have had an assignee, leaving `previous_assignee` time
  scopes empty.
- Month boundaries depend on timezone; artifact keys must use a stable project timezone.
- Zero tracked hours need explicit behavior.
- Reassignment may remove the developer's ability to edit the work item, while historical
  rows must remain available for periods containing their time.
- Multiple rules may target the same assignee or provider comment.
- Rule edits during a pending retry must not change an already-started run; retries must use
  the recorded rule version.
- Templates may exceed provider limits or contain unsafe markup.
- User Stories do not support Time Management aggregation in the current domain model.
- Existing hardcoded `CompletedWork` synchronization may overlap with future field-update
  actions.
- Existing automated tests do not cover status workflow, assignment, provider sync, or time
  ownership, so compatibility tests will be a substantial planning deliverable.

## Open Questions

- **Question:** Are rules project-wide or personal?
  - **Current answer:** The example represents a team workflow and selects another project
    member.
  - **Recommendation:** Start with administrator-managed project rules. Consider personal
    rules only after project-rule ownership and conflict semantics are proven.

- **Question:** Which status-change origins execute rules?
  - **Current answer:** The primary use case is a user changing status in Project Manager.
  - **Recommendation:** Run the first version only for `local_user` events, but store origin,
    correlation, and causation metadata from the start.

- **Question:** Which application surfaces should emit the initial status trigger?
  - **Current answer:** The motivating case is a Task or Bug changed from Time Management;
    Release Planning currently uses different status semantics and includes User Stories.
  - **Recommendation:** Start with canonical manual Task and Bug transitions from Time
    Management. Unify Release Planning with the same workflow gates and event boundary before
    enabling rules there.

- **Question:** Should an automation failure reject or roll back the status transition?
  - **Current answer:** Current provider status-sync failures preserve the local status.
  - **Recommendation:** Preserve that behavior. Commit the status, report automation
    failures, and retry safe actions without rolling back the transition.

- **Question:** Should assignment update local state before or after the provider?
  - **Current answer:** Existing status sync is local-first, while manual Release Planning
    assignment is provider-first.
  - **Recommendation:** Centralize assignment behavior. For `providerSync: required`, use
    provider-first and update local assignment only after provider success. Support
    `best_effort` and `local_only` explicitly rather than relying on route-specific behavior.

- **Question:** Which credential executes provider actions?
  - **Current answer:** Azure DevOps calls currently use the triggering user's project-scoped
    PAT.
  - **Recommendation:** Use the event actor's credential for immediate execution and show
    this prerequisite in validation and execution logs. Decide on a project service identity
    before adding unattended or scheduled execution. The parked
    [PAT retirement plan](azure-devops-pat-retirement.md) makes this decision more urgent
    than it appears: freezing an actor credential for durable retries is incompatible with
    short-lived Entra OAuth tokens, so unattended execution effectively requires a service
    identity or a refresh-token flow once PATs are retired.

- **Question:** Does assigning a work item to QA also add it to QA's Time Management list?
  - **Current answer:** These are separate relationships in the current domain.
  - **Recommendation:** Keep them as separate explicit actions. The rule editor may recommend
    `time_management.ensure_membership` after an assignment without creating hidden coupling.

- **Question:** Which user's hours should the example comment contain?
  - **Current answer:** Reassignment occurs during the rule, so "current assignee" becomes
    ambiguous.
  - **Recommendation:** Use the immutable previous assignee by default for a handoff rule.
    Allow triggering actor, selected user, and all-user aggregation as explicit alternatives.
    When the work item had no previous assignee, skip the action with an explicit skip
    reason instead of silently falling back to another scope; a configurable fallback scope
    can be considered later.

- **Question:** Which period should be summarized?
  - **Current answer:** The example asks for month and year but does not define whether all
    months or only the current month are included.
  - **Recommendation:** Use the event month in the project timezone for the first version. A
    later action mode may upsert one comment for every month containing time.

- **Question:** Should the monthly comment update when time entries change after resolution?
  - **Current answer:** A status-only trigger produces a snapshot.
  - **Recommendation:** Treat it as a snapshot initially. If the comment must remain live,
    add a separate `time_entry.changed` trigger using the same artifact identity.

- **Question:** What happens when total tracked time is zero?
  - **Current answer:** The desired behavior is not specified.
  - **Recommendation:** Make `skipIfZero` an explicit action option and default it to `false`
    so missing time is visible rather than silently omitted.

- **Question:** Can generated provider comments be edited manually?
  - **Current answer:** Provider users may be able to edit them.
  - **Recommendation:** Compare the provider content with the last rendered hash. Report a
    conflict instead of overwriting a manual edit by default, and never fuzzy-match or
    overwrite an unrelated comment.

- **Question:** Can the previous assignee correct time after the automated QA handoff?
  - **Current answer:** Current time-entry writes require the work item to remain assigned to
    the user, so the developer loses edit access after reassignment even though historical
    rows remain visible for periods containing their time.
  - **Recommendation:** Preserve the current authorization behavior in the initial automation
    design and resolve the comment's time snapshot before reassignment. If post-handoff time
    correction is required, design it as a separate permission change rather than weakening
    authorization implicitly inside a rule.

- **Question:** Should local-only work items support comments?
  - **Current answer:** There is no local work item comment model.
  - **Recommendation:** Keep the initial comment actions provider-only. Design a separate
    local comment domain before presenting provider and local comments as one capability.

- **Question:** How should multiple matching rules resolve conflicting writes?
  - **Current answer:** Existing behavior does not define cross-rule conflicts.
  - **Recommendation:** Add explicit priority and claim exclusive fields at preflight: the
    highest-priority matching rule owns the field, lower-priority conflicting actions are
    skipped as superseded even if the claiming action later fails, and preview and execution
    history expose the overlap.

- **Question:** Should the current hardcoded `CompletedWork` behavior become a rule?
  - **Current answer:** It is existing behavior and must not regress.
  - **Recommendation:** Initially preserve it as explicit system behavior outside editable
    rules. Consider a visible non-editable system rule only after all status entry points use
    the same engine and compatibility tests cover the old behavior.

- **Question:** What are the exact template syntax, locale, and timezone rules?
  - **Current answer:** The project currently has no automation template contract or explicit
    project locale/timezone setting.
  - **Recommendation:** Use an allowlisted Mustache-like syntax, ISO `YYYY-MM` artifact keys,
    an explicit project timezone for period boundaries, and locale only for display
    formatting. Adding project timezone/locale settings would be a prerequisite for reliable
    period rendering.

- **Question:** How should retries obtain authorization?
  - **Current answer:** Immediate provider calls use the event actor's stored project
    credential, but a durable worker may run after that identity or access changes.
  - **Recommendation:** Freeze the actor ID in the event, revalidate project access and
    credential availability on every attempt, and require manual intervention when they are
    no longer valid. Do not silently fall back to another user's credential.

- **Question:** Is synchronous execution sufficient for the first implementation?
  - **Current answer:** The app has no durable worker or queue runtime today.
  - **Recommendation:** Start with synchronous execution plus persistent events, per-action
    audit records, and manual retry. Add a background worker only when unattended retries are
    explicitly included in a later scope.

## Promotion Criteria

Before promoting this idea to a planning document:

- Plan the Phase 0 prerequisites — the shared status-change boundary, compatibility tests,
  the work item revision, and project timezone settings — as explicit, separately verifiable
  work.
- Resolve every open question that affects user-visible behavior, provider consistency,
  authorization, and retry semantics.
- Decide the initial trigger, condition, and action catalog.
- Decide whether durable background retries belong to the first implementation slice.
- Define compatibility tests for workflow gates, status synchronization, assignment, Time
  Management visibility, `CompletedWork`, and provider-disabled projects.
- Obtain explicit user approval before setting a planning document to `Ready`.

## Links

- [Domain model](../features/domain-model.md)
- [Time tracking](../features/time-tracking.md)
- [Azure DevOps integration](../features/azure-devops-integration.md)
- [Release planning](../features/release-planning.md)
- [Settings](../features/settings.md)
- [Azure DevOps PAT retirement](azure-devops-pat-retirement.md)

## Notes

This document is exploratory. It does not authorize implementation and does not describe
current application behavior.
