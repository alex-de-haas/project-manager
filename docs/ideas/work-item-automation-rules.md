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
- Project Manager creates or updates a native work item comment containing the developer's
  tracked time for the event month, for example `14.50 h (July 2026)`.
- Every configured integration independently attempts to synchronize the resulting canonical
  status, assignment, and comment.

Rules must be configurable without arbitrary code execution. Rule triggers, conditions, and
actions operate exclusively on Project Manager domain entities. External integrations
observe and synchronize resulting domain changes; they are not rule action destinations.
Provider availability, credentials, remote capabilities, and delivery results do not
participate in rule matching or rule success. Provider-originated changes may still become
canonical domain events with explicit causal metadata.

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
  remain explicit as an Azure DevOps integration projection, must not regress, and must not
  become a configurable rule action.
- Work item assignment and Time Management membership are separate relationships.
  Assigning a work item to QA does not automatically add it to the QA user's Time
  Management list.
- Assignment is stored canonically in Project Manager, but assignment behavior is not
  centralized. The local Task API and the Azure DevOps Release Planning flow have different
  authorization and synchronization order, and there is no universal assignment command
  shared by every work item surface.
- Provider user identities are mappings from Project Manager users to external identities.
  They should be used by integration synchronization after a native assignment commits, not
  as prerequisites for the native assignment itself.
- Project Manager has no native work item discussion/comment entity. Existing comments
  belong to blockers, not to the work item discussion. A first-class work item comment
  capability is required before automation can create or update comments.
- Project configuration currently supports no integration or one selected provider. The
  automation model must not inherit that limit because future projects may synchronize with
  multiple integrations independently.
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
- Native work item comment creation and idempotent update.
- Safe template parameters for generated content.
- Deterministic ordering, conflict handling, audit history, and retries.
- Domain-only rule definitions whose resulting canonical changes are synchronized by the
  integration layer independently of automation.

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
- Remains provider-neutral by invoking only validated Project Manager domain commands.
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

Rules should initially run only for user-caused status transitions. Event cause, channel,
correlation, and causation metadata should exist from the start so provider refreshes,
imports, API channels, and automation-caused events can be considered without introducing
loops.

Every action must invoke a validated Project Manager domain capability that is also available
inside Project Manager itself. A rule must behave the same for a local-only work item and an
externally linked work item. Integration links, provider identities, credentials, remote
capabilities, and synchronization results belong to the integration layer and must not appear
in action configuration.

Do not support arbitrary scripts, expressions, SQL, or HTTP requests.

## Domain-First Principle

The action catalog is bounded by Project Manager's own domain commands:

- If Project Manager does not expose an operation as a validated native capability for an
  authorized Project Manager workflow, automation cannot use it as a shortcut through an
  external provider.
- A rule targets Project Manager work items, project members, Time Management memberships,
  comments, and other native entities only.
- A successful action means the canonical Project Manager mutation committed.
- Zero, one, or several integration adapters may observe the committed domain event and
  synchronize it to their external systems.
- Missing provider mappings, disabled synchronization, expired credentials, unsupported
  remote capabilities, and provider failures do not invalidate or roll back a successful
  native rule action. They are separate integration synchronization results.
- Provider-specific fields and operations, including Azure DevOps `CompletedWork`, are
  integration projections rather than rule actions.

This boundary keeps the automation system useful without any integration and prevents Azure
DevOps from becoming an accidental part of the Project Manager domain model.

### Rule Execution Principal

An event actor and a rule executor are different concepts. The developer who resolves a Bug
may not have permission to assign it to another project member even though a Hosty
administrator deliberately configured that project-wide rule.

The current recommendation is a bounded project-automation principal that:

- Can invoke only allowlisted native commands configured by a Hosty administrator.
- Is restricted to the rule's project and cannot bypass command validation, workflow gates,
  target membership, or entity revision checks.
- Never receives provider credentials and never calls an integration directly.
- Records the initiating event actor, rule creator/updater, and automation executor
  separately in audit data.

Using the event actor as the executor is a simpler alternative but would make rule behavior
depend on which project member triggered the same transition. This authorization choice must
be resolved before a planning document becomes `Ready`.

## Prerequisites (Phase 0)

Automation rules must not introduce new domain behavior indirectly through provider APIs.
The following capabilities are independently useful features and should be planned,
implemented, documented, and verified before the dependent rule actions are enabled. They
will likely need separate planning documents rather than being hidden inside the automation
implementation.

### Phase 0A: Canonical Work Item Mutations

- Route every manual status change through one Project Manager command that applies workflow
  gates, normalizes status, and records the change cause and channel.
- Add a monotonic work item revision or equivalent compare-and-swap mechanism so concurrent
  requests cannot create events from stale state. This must be a new native `work_items`
  field. The existing `provider_revision` column on `work_item_external_links` is
  provider-scoped, currently never read or written, and must not be repurposed for the
  canonical work item revision.
- Persist each canonical mutation and its immutable domain event in one SQLite transaction.
- Migrate each provider-first route only after its equivalent native command and the shared
  integration projection boundary exist. Status routes can migrate in Phase 0A; assignment
  routes also depend on Phase 0B.
- Add characterization tests before the refactor for workflow gates, status changes,
  assignment, Time Management visibility, provider synchronization, and the existing Azure
  DevOps `CompletedWork` projection.

### Phase 0B: Native Assignment Capability

Introduce one canonical assignment command that:

- Accepts a Project Manager work item and a Project Manager project member.
- Applies one authorization and project-membership policy across supported work item types
  and application surfaces.
- Updates canonical `assigned_user_id`, increments the work item revision, and emits
  `work_item.assignee_changed` in one transaction.
- Is available through Project Manager UI/API without requiring an integration, external
  identity, credential, or synchronization policy.

Integration adapters consume the assignment event and map the selected Project Manager user
to an external identity when possible. A missing mapping or external rejection produces an
integration synchronization failure without undoing the native assignment. This intentionally
changes the current provider-first Release Planning assignment contract and therefore needs
explicit compatibility tests and user-facing divergence diagnostics.

Assignment must not imply Time Management membership.

### Phase 0C: Validated Time Management Membership Capability

Promote the existing membership helper into a validated domain command that checks the work
item, project, supported type, target project member, authorization, and idempotency before it
creates a membership. Both the normal UI and automation should invoke the same command.

### Phase 0D: Native Work Item Comments

Introduce a first-class Project Manager work item comment domain with:

- A native comment identifier, canonical work item and project ownership, and an explicit
  canonical content format.
- Human or automation source, author/updater attribution, timestamps, and a monotonic comment
  revision.
- Native create and update commands with authorization rules.
- Durable `work_item.comment_created` and `work_item.comment_updated` events.
- Project Manager UI/API where comments can be inspected without an external integration.
- A stable automation ownership key for comments created or updated by a rule.

Rules operate only on the native comment. The integration layer may maintain a separate
mapping from native comment ID to each provider's external comment ID, revision, and sync
diagnostics. A provider that cannot create or update comments reports an unsupported
synchronization result rather than changing rule behavior or silently creating duplicates.

### Phase 0E: Shared Domain Event and Integration Boundary

- Store immutable domain events independently of consumer processing state.
- Track automation consumption separately from integration projection and delivery state.
- Allow every enabled integration adapter to observe the same committed canonical change.
- In the canonical mutation transaction, upsert a projection request for each configured
  integration link and affected entity. Requests use a unique integration-link/entity key
  and the desired canonical revision so a crash cannot lose the handoff.
- Keep external calls outside SQLite transactions and expose integration failures separately
  from automation failures.
- Define echo suppression for provider-originated refreshes before enabling those causes as
  rule triggers.
- Retain the causative domain event ID and actor when a derived projection depends on them.
  This is required to preserve the current requesting-user aggregation used by Azure DevOps
  `CompletedWork` even when several canonical revisions are coalesced.

### Phase 0F: Project Time Settings

Add project timezone and locale settings before enabling period-based templates. Period
boundaries, artifact keys, and rendered month names cannot be deterministic without them.

## Recommended Dependency Slices

Phase 0 should not become one oversized planning document. The work has independently useful
boundaries and should be promoted into separate planning documents only after their own open
questions are resolved and the user approves them.

Recommended sequence:

1. Characterization tests for current status, assignment, Time Management, and integration
   behavior.
2. Canonical status/assignment/membership commands, entity revisions, and durable domain
   events.
3. Provider-neutral integration projection and delivery tracking for canonical mutations.
4. Automation rules core with native assignment and Time Management membership actions.
5. Native work item comments as a separate user-facing feature.
6. Project timezone/locale settings and the native monthly-comment action.
7. Comment projection adapters for each integration that supports comments.

The automation core does not need to wait for comments or timezone settings if its first
slice contains only assignment and Time Management actions. The full motivating workflow,
including the monthly comment, depends on every relevant Phase 0 capability.

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
- A native comment template variable picker and rendered preview.
- A dry run against a selected work item that shows matching conditions, resolved parameters,
  intended native mutations, conflicts, and domain validation errors without mutating data.
- Per-rule execution history with per-action results and retry state.
- Integration synchronization health on affected work items and comments, presented
  separately from rule validity and rule execution state.

Rules should initially be project-scoped and manageable only by Hosty administrators.
Personal rules and shared rule templates can be considered later.

## Rule Structure

A rule contains:

- A stable rule identifier and schema version.
- An immutable identifier for every action, separate from any editable action label or key.
- Project scope.
- Name and optional description.
- Enabled state.
- Explicit priority.
- One typed trigger.
- An optional typed condition tree.
- One or more ordered typed actions.
- An execution policy for the native actions inside one rule: atomic by default, with an
  optional per-action best-effort flag for tolerable failures such as comment conflicts.
- Creation and update audit fields.

Conceptual example:

```yaml
name: Hand resolved bugs to QA
enabled: true
priority: 100

trigger:
  type: work_item.status_changed
  causes:
    - user

conditions:
  all:
    - field: work_item.type
      operator: equals
      value: bug
    - field: status.to
      operator: equals
      value: resolved

actions:
  - key: assign-qa
    order: 10
    type: work_item.assign
    target:
      kind: project_user
      userId: 42

  - key: add-to-qa-time-management
    order: 20
    type: time_management.ensure_membership
    target:
      kind: action_target
      actionKey: assign-qa

  - key: monthly-time-comment
    order: 30
    type: work_item.comment.upsert
    criticality: best_effort
    timeScope: event_assignee
    period: event_month
    artifactScope: work_item_period
    template: "{{ time.total_hours | number(2) }} h ({{ period.month_name }} {{ period.year }})"
```

The exact serialized format is an implementation detail. The API should expose typed
structures rather than accept arbitrary JSON with unvalidated fields. In this example `key` is
the editable human-readable label; the stored rule assigns every action the immutable
identifier described in Rule Structure, and cross-action references such as `actionKey` resolve
to that immutable identifier so renaming a key never breaks a reference.

## Trigger Model

The first trigger should be `work_item.status_changed`. The event must be emitted only when
the normalized status actually changes.

Its immutable snapshot should include:

- Event ID and occurrence time.
- Project ID.
- Cause: `user`, `provider_refresh`, `import`, `automation`, or `system`.
- Channel: `ui`, `api`, or `background`.
- Actor user ID and display snapshot when an actor exists.
- Correlation and causation IDs.
- Work item identity, type, and title.
- Previous and next status.
- Assignee at event time. A future assignee-change event may additionally carry previous and
  next assignee snapshots.
- Work item revision or update timestamp.
- Optional project timezone and locale. Period-based actions fail preflight when required
  project time settings do not exist.

Conditions and templates should read this immutable snapshot. Their meaning must not change
because an earlier action mutates the work item.

The snapshot freezes identities and parameters, not derived aggregates. Time aggregation
runs against the database when an action executes, using frozen snapshot parameters such as
the event assignee, event month, and project timezone. The aggregate is deliberately
recomputed on each attempt so a retry uses the latest time entries for that frozen scope.
This is safe because reassignment does not delete historical time entries.

Every canonical command emits a domain event. The first automation consumer executes rules
only for `cause=user` events and ignores unsupported causes. The cause filter remains part of
the trigger schema, but the rule editor does not expose it until other causes become
executable.

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
- `actor.user_id`
- `event.cause`
- `event.channel`

`time.total_hours` is intentionally not a first-version condition field. Time aggregation is
defined by action configuration — user scope, period, and timezone — and a bare condition
field has no defined aggregation scope. A time-based condition needs those parameters
specified before it can join the catalog.

`work_item.tags` is intentionally not a first-version condition field either. Tags are
currently provider-projected metadata refreshed from Azure DevOps, not a native Project
Manager work item attribute. Matching on them would read integration-owned data and violate
the domain-first boundary. A tag condition can join the catalog only after native work item
tags exist as a first-class domain field, which is the same prerequisite as the future "set
or clear native work item tags" action.

Candidate typed operators include:

- `equals`
- `not_equals`
- `in`
- `not_in`
- `contains`
- `exists`
- Numeric comparison operators for numeric fields.

The UI must only offer operators valid for the selected field type.

## Candidate Action Catalog

### `work_item.assign`

Assign the canonical Project Manager work item to a selected project member by invoking the
native assignment command.

The action has no provider or synchronization options. A target that is no longer a project
member fails domain preflight. A missing external identity does not fail the action; after the
native transaction commits, each configured integration independently attempts to map and
synchronize the selected Project Manager user.

Project Manager currently has no QA role. The initial action therefore selects a concrete
project user; role-based or group-based targets are a separate future idea.

### `time_management.ensure_membership`

Ensure that the work item exists in a selected user's Time Management list.

This must remain separate from assignment. Some teams want ownership without automatically
adding an item to the assignee's personal Time Management list, while QA handoff workflows
may want both actions.

### `work_item.comment.upsert`

Create or update one automation-owned native work item comment using a stable artifact
identity. The action invokes the Phase 0 native comment command and never searches external
provider comments or adopts a human comment based on text similarity.

External comment creation and update are integration projections of the resulting native
comment events.

### Future Actions

Potential future actions include:

- Append a native work item comment. The upsert action covers the motivating workflow, and a
  second, similar comment action is not needed in the initial catalog.
- Set or clear native work item tags.
- Add a checklist item.
- Create a Project Manager notification.

Status-changing actions require recursion controls and should not be part of the first
version. Raw provider fields, external comments, and integration calls must never enter this
catalog; a new action becomes eligible only after the corresponding native Project Manager
capability exists.

## Parameters and Templates

Templates must use a small allowlisted syntax and must never evaluate JavaScript or arbitrary
expressions.

Template variables are a separate namespace from condition fields. Where they name the same
concept the mapping is intentional — for example the condition field `actor.user_id` and the
template variable `actor.id` both refer to the event actor.

Candidate variables include:

- `project.id`
- `project.name`
- `work_item.id`
- `work_item.title`
- `work_item.type`
- `status.from`
- `status.to`
- `actor.id`
- `actor.display_name`
- `assignee.at_event.id`
- `assignee.at_event.display_name`
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
variables should fail instead of silently becoming empty strings. The current recommendation
is to store template output as canonical Project Manager Markdown, consistent with work item
descriptions. The final format is resolved with the native comment feature. Integration
adapters are responsible for translation, provider markup, and provider-specific limits.

Time aggregation is action configuration, not template code. For example:

- Work item: triggering work item.
- User scope: triggering actor, event assignee, selected user, or all users.
- Period: event month.
- Timezone: project timezone.
- Aggregation: sum of time entries.

## Monthly Time Comment Upsert

A generated comment must be identified independently of its rendered text. Fuzzy matching
against human-readable text could modify an unrelated manual comment.

Recommended artifact identity:

```text
rule_id + action_id + work_item_id + period_key
```

For example, resolving the same Bug twice in July 2026 must target the same artifact for
period key `2026-07`.

Store a native managed-artifact record containing:

- Rule and action identifiers.
- Work item.
- Period key.
- Native work item comment ID.
- Last rendered content hash.
- Last observed native comment revision.

The upsert algorithm should:

1. Resolve the stable artifact identity.
2. Find the mapped native work item comment.
3. Create a new native comment when no managed artifact exists.
4. Update the mapped native comment only when its revision and content still match the last
   automation-owned version.
5. Report a native edit conflict when a user changed the managed comment.
6. Treat deletion of the previously managed native comment as a conflict. Do not recreate it
   automatically in the initial version.
7. Never search for or adopt a human comment based on rendered text.
8. Commit the native comment, managed-artifact mapping, and comment domain event atomically.

The generated comment is automation-managed, but the safe default is to report a conflict
instead of overwriting a manual edit. A later explicit conflict policy could allow replacement
when a team intentionally treats the entire comment as generated content.

External comment IDs, provider revisions, recovery markers, remote edits, and delivery
failures belong to integration-owned comment mappings. They are not part of the automation
artifact identity or upsert algorithm.

A status-only trigger produces a comment snapshot. Keeping the comment synchronized after a
later time-entry edit would require a separate `time_entry.changed` rule or an explicit rerun
using the same artifact identity.

## Ordering, Failure, and Atomicity

The primary local status transition and creation of a durable domain event should be
committed in one SQLite transaction after workflow gates pass.

Recommended execution flow:

1. Validate and commit the initiating native status transition and durable domain event.
2. Match enabled rule versions against the immutable event snapshot.
3. Resolve cross-rule conflicts, preflight every native action, and capture expected entity
   revisions and action preconditions in priority order.
4. Create or claim a durable `running` rule-run envelope containing the frozen rule,
   executor, and preconditions in a short transaction.
5. Execute all ordered actions inside one matching rule in one SQLite transaction. On
   success, persist the native managed artifacts, action results, resulting domain events,
   projection requests, and `succeeded` rule status in that same transaction.
6. If a critical action fails, roll back the action transaction and use a separate transaction
   to mark the durable rule run `failed` with `rolled_back` action diagnostics. A best-effort
   action failure is recorded on that action without rolling back the transaction or failing
   the rule run.
7. Repeat for the remaining matching rules in deterministic order.
8. Let zero or more integration adapters independently synchronize the latest committed
   canonical state and comments.

Integration delivery is not part of the rule transaction. External calls never run inside a
SQLite transaction, and their outcomes never change whether the native rule committed.

Recommended default semantics:

- A failed automation action does not roll back the accepted status transition.
- Native actions inside one rule are atomic by default: either every action commits or none
  does. An action may be marked best-effort so a tolerable failure — for example a comment
  upsert conflict — is recorded without rolling back the critical assignment and membership
  actions in the same rule (see the atomicity open question).
- Different matching rules have independent transactions, so one failed rule does not roll
  back another successful rule.
- A rule run can be `running`, `succeeded`, `failed`, `skipped`, or `stale`; there is no
  `partially_succeeded` rule state. A failed critical action fails the whole rule, while a
  failed best-effort action leaves the rule `succeeded` and is recorded only at the action
  level.
- Retrying a failed rule reuses the frozen rule snapshot and idempotency keys, then rechecks
  every expected entity revision and precondition.
- A retry never overwrites a newer manual status, assignment, membership, or comment change.
  A mismatched destructive target marks the run `stale` and requires a new event or explicit
  manual rerun. Read-only time aggregates may be recomputed for the frozen user/period scope.
- A successful rule remains successful when an integration later fails to synchronize its
  status, assignment, or comments.
- Provider retries, credentials, unknown remote outcomes, remote conflict resolution, and
  field coalescing are tracked by integration delivery records rather than automation runs.

A practical first implementation can consume the durable event immediately for fast UI
feedback and leave an unfinished local rule run for manual retry or a later worker. A
synchronous coordinator should drain automation before flushing integration projections so
an adapter can coalesce the latest status, assignment, and derived fields into one remote
update where supported.

## Multiple Matching Rules and Conflicts

Rules and actions must always have deterministic ordering.

Actions such as assignment write an exclusive property. If multiple matching rules attempt
to assign different users, the engine must not silently alternate ownership.

Recommended initial policy:

- Higher-priority matching rules execute first.
- Exclusive targets are claimed at preflight from match results: the highest-priority
  matching rule that configures an exclusive property, such as assignment, owns it.
- A lower-priority rule containing a conflicting exclusive action is skipped as a whole,
  including actions that depend on the skipped assignment. Teams should place independent
  non-exclusive behavior in a separate rule when it must still run.
- The ownership decision does not fall through to a different assignee when the claiming
  rule later fails; that rule is retried or corrected instead.
- This creates a sharp combined failure mode with synchronous execution and no worker: if the
  claiming rule wins the field at preflight but then fails or rolls back during execution, the
  lower-priority rule was already skipped, so neither rule's actions commit and the work item
  is left untouched until a manual retry. Two mitigations should be evaluated before this
  becomes `Ready`: (a) skip only the conflicting exclusive action rather than the whole
  lower-priority rule, still running that rule's independent actions; or (b) resolve exclusive
  ownership from committed results rather than preflight matches so a failed claim releases the
  field. The first version should not silently swallow both rules.
- The editor and dry-run preview warn when enabled rules can overlap.
- Non-exclusive actions, such as comments with different artifact identities, may coexist.

## Conceptual Persistence Model

Rules should use dedicated project-scoped tables rather than the generic per-user Settings
key-value table. Dedicated records are needed for ordering, referential integrity, audit
history, execution diagnostics, and native managed artifacts.

Candidate records are:

- `automation_rules`: project, name, enabled state, priority, trigger type, validated trigger
  configuration, validated condition tree, schema version, and audit fields.
- `automation_rule_actions`: rule, immutable action ID, optional human-readable key, order,
  action type, validated action configuration, direct foreign keys for referenced users where
  applicable, and audit fields.
- `domain_events`: immutable native event envelope, entity revision, cause, channel,
  correlation and causation IDs, and canonical payload. Consumer processing state does not
  belong on the event itself.
- `automation_rule_runs`: event, a denormalized snapshot of the matched rule configuration
  (no separate rule-version table is required), match result, overall status, attempt count,
  initiator and executor, expected entity revisions, timestamps, and summarized error.
- `automation_action_runs`: rule run, frozen action configuration, idempotency key, status,
  attempts, resolved native inputs, native entity IDs, result metadata, and sanitized error.
- `automation_managed_artifacts`: rule action, work item, artifact scope such as `2026-07`,
  native entity type, native entity ID, last rendered content hash, and native revision.

Phase 0 and integration-owned records include:

- `work_item_comments`: canonical native comments and their revisions.
- `work_item_comment_external_links`: mappings from native comments to external comments,
  including provider revision, synchronization status, and diagnostics.
- `integration_projection_requests`: per-integration-link/entity desired canonical revisions,
  causative event/actor when required, and unique delivery keys waiting to be projected by
  zero or more integration adapters.
- `integration_deliveries`: provider-specific attempts, non-secret credential owner/reference,
  unknown remote outcomes, retries, and sanitized errors.

Configuration may use versioned JSON inside these typed records for extensibility, but every
shape must be validated by the application. Automation records must not contain raw provider
credentials, external delivery state, or other integration secrets.

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
- QA User is a Project Manager project member.
- Native Project Manager work item comments and the canonical assignment command are
  available from Phase 0.
- The rule uses `timeScope: event_assignee` and `period: event_month`.

When Developer A changes the Bug from `in_progress` to `resolved`:

1. Existing workflow gates validate the transition.
2. Project Manager commits `resolved` and a `work_item.status_changed` domain event whose
   snapshot records Developer A as the actor and event assignee.
3. The rule matches type `bug` and target status `resolved`.
4. Domain preflight resolves Developer A, QA User, July 2026, and the native managed-comment
   key.
5. In one rule transaction, Project Manager assigns the Bug to QA User and ensures that the
   Bug appears in QA User's Time Management list.
6. The comment action queries Developer A's July time entries using the frozen snapshot
   parameters (event assignee, event month, project timezone), renders
   `14.50 h (July 2026)`, and creates or updates the automation-owned native July comment in
   the same transaction.
7. Project Manager records the successful rule result and emits domain events for the
   committed assignment, membership, and comment changes.
8. Every configured integration independently attempts to synchronize the latest canonical
   status, assignment, and comment. Integration failure does not change the successful rule
   result.

If the Bug is reopened and resolved again during July, the same monthly comment is updated
instead of duplicated. The same native workflow works when no integration is configured.

## Integration Synchronization Impact

Integrations consume canonical Project Manager changes; automation does not call them:

- Assignment adapters map the selected Project Manager user through provider identity
  mappings after the native assignment commits.
- Comment adapters map a native comment ID to provider-specific comment IDs and translate
  canonical Markdown into the remote representation.
- Multiple enabled integrations may project the same domain event independently.
- Missing mappings, disabled synchronization, expired credentials, unsupported remote
  capabilities, remote validation errors, and unknown outcomes are integration delivery
  states. They do not make the rule invalid or unsuccessful.
- Integration projection requests should coalesce to the latest canonical work item revision
  where possible. An adapter may then synchronize status, assignment, and derived fields in
  one provider update.
- Azure DevOps `CompletedWork` remains an Azure adapter projection of native status and time
  data. A coalesced request retains the causative status event and actor so its current
  requesting-user aggregation can be preserved during the migration and covered by
  compatibility tests. The invariant is explicit: the projection always aggregates the
  status-event actor's time for the event period. A rule that reassigns the work item to QA
  must not change whose time is written, so the projection must never switch to the
  post-automation assignee and silently zero or alter `CompletedWork`.
- An inbound provider value must not overwrite a newer unsynchronized local desired revision.
  The adapter compares its last-synced revision with current canonical state and records
  divergence when the local value advanced.
- Provider-originated refresh uses canonical commands with `cause=provider_refresh` and
  source-provider metadata. Initial rules ignore that cause, and the originating adapter
  suppresses echo back to the same provider.
- Credential lifecycle and unattended integration retries belong to integration planning.
  The [PAT retirement idea](azure-devops-pat-retirement.md) remains relevant there, but it
  does not affect the rule action contract.

## Risks

- A transition rejected by checklist or blocker gates must run no rules.
- Setting the current status again must not emit a new event.
- Provider refresh, import, and automation-caused changes may cause duplicate behavior unless
  event cause and channel are explicit.
- Distributed status update paths may omit rules or bypass existing workflow gates until
  they share a command or event boundary.
- A rule target may leave the project after the rule is enabled.
- Concurrent status changes require a work item revision check and unique event IDs.
- Event redelivery and retries must not duplicate assignments, memberships, or comments.
- A work item may be resolved more than once in the same month.
- A generated native comment may be edited or deleted by a user.
- Time entries may be changed after the status transition, leaving a snapshot comment stale.
- A work item may contain time from multiple users or multiple months.
- A resolved work item may never have had an assignee, leaving `event_assignee` time
  scopes empty.
- Month boundaries depend on timezone; artifact keys must use a stable project timezone.
- Zero tracked hours need explicit behavior.
- Reassignment may remove the developer's ability to edit the work item, while historical
  rows must remain available for periods containing their time.
- Multiple rules may target the same assignee or create competing managed comments for the
  same work item and period.
- Rule edits during a pending retry must not change an already-started run; retries must use
  the recorded rule version.
- A work item may be deleted, or the project's integration provider switched or removed, while
  a rule run is pending or being retried; the run must resolve to a terminal state instead of
  acting on a missing entity.
- Templates may contain invalid or unsafe Markdown; adapters may also reject or truncate a
  valid native comment because of provider-specific limits.
- User Stories do not support Time Management aggregation in the current domain model.
- A native assignment may succeed while an external system still shows the previous
  assignee; synchronization divergence must be visible without making the rule look failed.
- A native comment may commit while an integration cannot create or update its external
  projection.
- Provider-first legacy routes may overwrite or contradict native state until all mutations
  use canonical domain commands.
- Remote edits need an explicit integration conflict policy; the rule engine must not infer
  ownership from provider text.
- Multiple integrations may have different delivery results for the same canonical change.
- Automation and integration statuses may be confused unless the UI presents them as
  separate concepts.
- Existing Azure DevOps `CompletedWork` synchronization may regress when provider-first
  routes are moved behind domain events. The highest-risk case is a handoff rule: after it
  reassigns the work item, the projection must still aggregate the status-event actor's time,
  not the new assignee's, or a currently-correct `CompletedWork` value silently changes.
- Existing automated tests do not cover status workflow, assignment, provider sync, or time
  ownership, so compatibility tests will be a substantial planning deliverable.

## Open Questions

- **Question:** Are rules project-wide or personal?
  - **Current answer:** The example represents a team workflow and selects another project
    member.
  - **Recommendation:** Start with administrator-managed project rules. Consider personal
    rules only after project-rule ownership and conflict semantics are proven.

- **Question:** Which status-change causes execute rules?
  - **Current answer:** The primary use case is a user changing status in Project Manager.
  - **Recommendation:** Run the first version only for `cause=user` events, but store cause,
    channel, correlation, and causation metadata from the start.

- **Question:** Which application surfaces should emit the initial status trigger?
  - **Current answer:** The motivating case is a Task or Bug changed from Time Management;
    Release Planning currently uses different status semantics and includes User Stories.
  - **Recommendation:** After Phase 0, execute the initial rule for every canonical manual
    Task and Bug transition regardless of UI surface. Do not add a surface filter merely to
    preserve today's fragmented routes. User Story rules can remain outside the initial type
    catalog.

- **Question:** Should an automation failure reject or roll back the status transition?
  - **Current answer:** The initiating status transition and each matching rule use separate
    native transactions.
  - **Recommendation:** Preserve the accepted status transition, roll back every native
    action inside the failed rule, report the rule failure, and retry the whole frozen rule
    idempotently.

- **Question:** May a provider-originated refresh change canonical Project Manager
  assignment?
  - **Current answer:** Azure DevOps refresh currently maps external assignees back into
    `assigned_user_id`, but a domain-first multi-integration policy is not defined.
  - **Recommendation:** Treat this as an explicit integration policy using the canonical
    assignment command with `cause=provider_refresh`. Never overwrite a newer unsynchronized
    local desired revision; record divergence, suppress echo, and do not let the rule engine
    infer which system wins. This is a user-visible behavior change: today refresh
    unconditionally overwrites `assigned_user_id`, so the new revision-aware policy needs an
    explicit compatibility decision and test rather than being treated as an internal refactor.

- **Question:** Can one project have several active integrations at the same time?
  - **Current answer:** Project settings currently select no provider or one provider, while
    the target architecture must not couple rules to that restriction.
  - **Recommendation:** Design domain events and integration delivery as zero-to-many from
    the start. Decide the project configuration UX and cross-provider conflict policy in a
    separate integration plan.

- **Question:** Does assigning a work item to QA also add it to QA's Time Management list?
  - **Current answer:** These are separate relationships in the current domain.
  - **Recommendation:** Keep them as separate explicit actions. The rule editor may recommend
    `time_management.ensure_membership` after an assignment without creating hidden coupling.

- **Question:** Which user's hours should the example comment contain?
  - **Current answer:** Reassignment occurs during the rule, so "current assignee" becomes
    ambiguous.
  - **Recommendation:** Use the immutable event assignee by default for a handoff rule.
    Allow triggering actor, selected user, and all-user aggregation as explicit alternatives.
    When the work item had no event assignee, skip the action with an explicit skip
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

- **Question:** What is the canonical native comment format?
  - **Current answer:** Work item descriptions already use Markdown, but native work item
    comments do not exist.
  - **Recommendation:** Store comments as Markdown and make each integration adapter
    responsible for conversion and provider limits.

- **Question:** May users edit an automation-owned native comment?
  - **Current answer:** The desired ownership behavior is not defined.
  - **Recommendation:** Permit the edit, increment the native comment revision, and report an
    automation conflict on the next upsert instead of silently overwriting it.

- **Question:** How are comments edited directly in an external system reconciled?
  - **Current answer:** Provider comment import and conflict resolution do not exist.
  - **Recommendation:** Start with outbound native-comment synchronization and surface remote
    divergence. Do not import, adopt, or overwrite remote edits automatically until a
    separate integration conflict policy is designed.

- **Question:** Which native work item comments should integrations synchronize?
  - **Current answer:** There is no comment domain or synchronization contract today.
  - **Recommendation:** Define this as a project integration policy that applies consistently
    to human and automation comments. Do not add per-rule provider destinations or sync flags.

- **Question:** Can the event assignee correct time after the automated QA handoff?
  - **Current answer:** Current time-entry writes require the work item to remain assigned to
    the user, so the developer loses edit access after reassignment even though historical
    rows remain visible for periods containing their time.
  - **Recommendation:** Preserve the current authorization behavior in the initial automation
    design and freeze the event-assignee/period scope before reassignment. Recompute the
    aggregate from that frozen scope on each execution attempt. If post-handoff time
    correction is required, design it as a separate permission change rather than weakening
    authorization implicitly inside a rule.

- **Question:** How should multiple matching rules resolve conflicting writes?
  - **Current answer:** Existing behavior does not define cross-rule conflicts.
  - **Recommendation:** Add explicit priority and claim exclusive fields at preflight. The
    highest-priority matching rule owns the field; lower-priority rules with a conflicting
    exclusive action are skipped as a whole even if the claiming rule later fails. Preview
    and execution history must expose the overlap.

- **Question:** What are the exact template syntax, locale, and timezone rules?
  - **Current answer:** The project currently has no automation template contract or explicit
    project locale/timezone setting.
  - **Recommendation:** Use an allowlisted Mustache-like syntax, ISO `YYYY-MM` artifact keys,
    an explicit project timezone for period boundaries, and locale only for display
    formatting. Adding project timezone/locale settings is a prerequisite for reliable period
    rendering, but not for assignment-only rules.

- **Question:** Must every native action in one rule be atomic?
  - **Current answer:** Domain-only actions can share a SQLite transaction, unlike external
    provider calls. However, a non-critical comment conflict would then also prevent the QA
    assignment and Time Management membership from committing.
  - **Recommendation:** Keep rules atomic by default for deterministic behavior, but add a
    per-action `criticality` flag (`critical` or `best_effort`) from the first version and
    default `work_item.comment.upsert` to `best_effort`. Otherwise the flagship handoff is
    fragile: a routine comment-edit conflict would roll back the QA assignment and Time
    Management membership. Splitting behavior into separate rules is the fallback, but it then
    interacts with the exclusive-claim skip policy above, so it should not be the only option.
    Revisit explicit multi-action transaction groups only when a real workflow requires them.

- **Question:** Is synchronous execution sufficient for the first implementation?
  - **Current answer:** The app has no durable worker or queue runtime today.
  - **Recommendation:** Start with synchronous execution plus persistent events, per-action
    audit records, and manual retry. Because there is no worker in the first version, a
    `failed` or `stale` rule run is otherwise only visible to whoever opens the execution
    history, so surface it with a Project Manager notification to the rule administrator. Add a
    background worker only when unattended retries are explicitly included in a later scope.

## Promotion Criteria

Before promoting this idea to a planning document:

- Split Phase 0 into separately verifiable planning candidates for canonical mutations and
  events, native assignment/membership, native comments, integration projection, and project
  time settings.
- Treat native work item comments as a separate user-facing feature with its own UX,
  authorization, deletion, editing, and synchronization decisions.
- Complete the canonical assignment and Time Management commands before exposing their rule
  actions.
- Complete native comments before exposing `work_item.comment.upsert`.
- Complete project timezone/locale settings before enabling period-based templates.
- Define the provider-neutral post-commit integration projection contract without placing
  provider settings in rule configuration.
- Resolve every open question that affects user-visible behavior, canonical ownership,
  authorization, automation retries, and integration divergence.
- Decide the initial trigger, condition, and action catalog.
- Decide whether the first rules slice contains only assignment/membership or also waits for
  the monthly-comment dependencies.
- Decide whether durable local automation retries belong to the first implementation slice;
  integration retries remain a separate concern.
- Define compatibility tests for workflow gates, status synchronization, assignment, Time
  Management visibility, native comments, `CompletedWork`, and disabled or missing
  integrations.
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
