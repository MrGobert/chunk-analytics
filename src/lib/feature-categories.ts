import { normalizeEventName } from '@/lib/mixpanel';
import type { MixpanelEvent } from '@/types/mixpanel';

/**
 * Map canonical event names to feature categories for cross-feature comparison.
 * All event names here must be canonical — legacy names resolve via
 * normalizeEventName(). Shared by feature-overview ("Users by feature"),
 * power-users, and Pulse top-movers.
 *
 * IMPORTANT — these are GENUINE-USAGE events only: a user creating, viewing,
 * completing, saving, sharing, exporting, uploading, deleting, or generating
 * content. Passive UI-exposure events are deliberately EXCLUDED so that merely
 * being shown an onboarding screen or clicking around the UI is not counted as
 * "using" a feature. Counting those inflated "Users by feature" and produced
 * misleading Top-Mover spikes (e.g. an artifact-onboarding rollout reading as
 * "Artifacts +5500%"), while the feature's own detail tab — which tracks the
 * real create/complete/view lifecycle — correctly showed little activity.
 *
 * Do NOT add these back here (they remain available in each feature's own
 * detail route, e.g. the artifacts onboarding funnel):
 *   Artifact_Tab_Switched, Artifact_Filtered, Artifact_Searched,
 *   Artifact_Onboarding_Viewed/Completed/Skipped, Research_History_Viewed,
 *   Research_Settings_Changed, Research_Report_Filtered,
 *   Memory_Management_Viewed, Connector_Settings_Viewed,
 *   Automation_Limit_Hit, Automation_Paywall_Shown,
 *   Automation_Suggestion_Shown/Accepted/Dismissed, Automation_Kind_Selected,
 *   Automation_Recipe_Selected, Automation_Plan_Previewed, inbox_viewed,
 *   inbox_clipper_token_generated/revoked,
 *   inbox_email_alias_generated/disabled (friction/paywall/composer/passive
 *   events — all still on the capture-monitors detail route).
 *
 * Note: Capture events are intentionally snake_case — those are the frozen
 * production names (emitted server-side by cerebral / client triage), no
 * normalization applies.
 */
export interface FeatureDefinition {
  /** Lifecycle events that establish adoption and feature stickiness. */
  activityEvents: readonly string[];
  /** Comparable value-producing actions used by Top Movers. */
  primaryActionEvents: readonly string[];
  /** Human-readable labels for the primary-action breakdown. */
  eventLabels: Readonly<Record<string, string>>;
  /** Unit shown beside mover counts. */
  unit: string;
}

/**
 * Canonical cross-feature metric definitions.
 *
 * `activityEvents` deliberately stays broader than `primaryActionEvents`:
 * lifecycle activity is useful for adoption/stickiness, while Top Movers needs
 * one comparable value unit and must not double-count start + completion or
 * capture + triage. Errors and passive exposure events live in the detail and
 * reliability routes, not here.
 */
export const FEATURE_DEFINITIONS = {
  Search: {
    activityEvents: ['Search_Performed'],
    primaryActionEvents: ['Search_Performed'],
    eventLabels: { Search_Performed: 'searches' },
    unit: 'searches',
  },
  Research: {
    activityEvents: ['Research_Report_Initiated', 'Research_Report_Completed', 'Research_Report_Viewed', 'Research_Report_Exported', 'Research_Report_Shared', 'Research_Report_Deleted', 'Research_Report_Added_To_Collection', 'Research_Published'],
    primaryActionEvents: ['Research_Report_Completed'],
    eventLabels: { Research_Report_Completed: 'reports completed' },
    unit: 'reports completed',
  },
  Notes: {
    activityEvents: ['Note_Created', 'Note_Viewed', 'Note_Saved', 'Note_Shared', 'Note_Published', 'Note_Writing_Tool_Used', 'Note_Uploaded_To_Documents', 'Note_Deleted'],
    primaryActionEvents: ['Note_Created'],
    eventLabels: { Note_Created: 'notes created' },
    unit: 'notes created',
  },
  Collections: {
    activityEvents: ['Collection_Created', 'Collection_Viewed', 'Collection_Chat_Started', 'Collection_Chat_Message_Sent', 'Collection_Exported', 'Collection_Shared', 'Collection_URL_Added', 'Collection_Updated', 'Collection_Deleted', 'Collection_URL_Removed'],
    primaryActionEvents: ['Collection_Created', 'Collection_Chat_Started', 'Collection_URL_Added'],
    eventLabels: {
      Collection_Created: 'collections created',
      Collection_Chat_Started: 'chats started',
      Collection_URL_Added: 'URLs added',
    },
    unit: 'core actions',
  },
  // Projects (web only, Pro to create, beta since Sep 2026) share the
  // collection substrate but are their own feature. Project_Start_Clicked is
  // intent and Project_Suggestions_Seen is passive exposure — both stay on the
  // Projects detail route, never here.
  Projects: {
    activityEvents: ['Project_Created', 'Project_Opened', 'Project_Plan_Created', 'Project_Plan_Appended', 'Project_Momentum_Opened', 'Project_Suggestions_Refreshed', 'Project_Suggestion_Acted', 'Project_Converted'],
    primaryActionEvents: ['Project_Created'],
    eventLabels: { Project_Created: 'projects created' },
    unit: 'projects created',
  },
  Artifacts: {
    activityEvents: ['Artifact_Created', 'Artifact_Completed', 'Artifact_Viewed', 'Artifact_Saved_To_Notes', 'Artifact_File_Uploaded', 'Artifact_Deleted', 'Artifact_Visual_Generated', 'Artifact_Batch_Started', 'Artifact_Batch_Completed'],
    primaryActionEvents: ['Artifact_Completed'],
    eventLabels: { Artifact_Completed: 'artifacts completed' },
    unit: 'artifacts completed',
  },
  Documents: {
    activityEvents: ['Document_Uploaded', 'Document_Viewed', 'Document_Deleted', 'Document_Attached'],
    primaryActionEvents: ['Document_Uploaded'],
    eventLabels: { Document_Uploaded: 'documents uploaded' },
    unit: 'documents uploaded',
  },
  'Image Gen': {
    activityEvents: ['Image_Generation_Started', 'Image_Generation_Completed'],
    primaryActionEvents: ['Image_Generation_Completed'],
    eventLabels: { Image_Generation_Completed: 'images completed' },
    unit: 'images completed',
  },
  Memory: {
    activityEvents: ['Memory_Viewed', 'Memory_Toggled', 'Memory_Added', 'Memory_Deleted'],
    primaryActionEvents: ['Memory_Added', 'Memory_Toggled'],
    eventLabels: {
      Memory_Added: 'memories added',
      Memory_Toggled: 'memory enabled',
    },
    unit: 'adds / enables',
  },
  Connectors: {
    // Provider-specific Notion_*/Gamma_* helpers duplicate the canonical
    // Connector_Operation_Used event and are intentionally excluded.
    activityEvents: ['Connector_Connect_Started', 'Connector_Connect_Succeeded', 'Connector_Disconnected', 'Connector_Operation_Used'],
    primaryActionEvents: ['Connector_Connect_Succeeded', 'Connector_Operation_Used'],
    eventLabels: {
      Connector_Connect_Succeeded: 'connections completed',
      Connector_Operation_Used: 'operations completed',
    },
    unit: 'successful actions',
  },
  // The in-chat "Connections" sidebar (NOT the Connectors OAuth feature above).
  Connections: {
    activityEvents: ['Connections_Pin_Toggled', 'Connections_Action_Used', 'Connections_Mention_Used', 'Connections_Collection_Created', 'Connections_References_Sent', 'Connections_Recall_Accepted'],
    primaryActionEvents: ['Connections_Pin_Toggled', 'Connections_Action_Used', 'Connections_Mention_Used', 'Connections_Collection_Created', 'Connections_References_Sent', 'Connections_Recall_Accepted'],
    eventLabels: {
      Connections_Pin_Toggled: 'pins changed',
      Connections_Action_Used: 'actions used',
      Connections_Mention_Used: 'mentions used',
      Connections_Collection_Created: 'collections created',
      Connections_References_Sent: 'references sent',
      Connections_Recall_Accepted: 'recalls accepted',
    },
    unit: 'actions',
  },
  Automations: {
    activityEvents: ['Automation_Created', 'Automation_Edited', 'Automation_Paused', 'Automation_Resumed', 'Automation_Deleted', 'Automation_Run_Now', 'Automation_Run_Viewed'],
    primaryActionEvents: ['Automation_Created', 'Automation_Run_Now'],
    eventLabels: {
      Automation_Created: 'automations created',
      Automation_Run_Now: 'manual runs',
    },
    unit: 'creations / runs',
  },
  Capture: {
    activityEvents: ['inbox_capture_created', 'inbox_item_accepted', 'inbox_item_discarded', 'inbox_item_to_collection'],
    primaryActionEvents: ['inbox_capture_created'],
    eventLabels: { inbox_capture_created: 'captures created' },
    unit: 'captures',
  },
} as const satisfies Record<string, FeatureDefinition>;

export type FeatureCategory = keyof typeof FEATURE_DEFINITIONS;

/** Backwards-compatible activity registry used by adoption and power-user views. */
export const FEATURE_CATEGORIES: Record<FeatureCategory, string[]> =
  Object.fromEntries(
    Object.entries(FEATURE_DEFINITIONS).map(([category, definition]) => [
      category,
      [...definition.activityEvents],
    ]),
  ) as unknown as Record<FeatureCategory, string[]>;

/** Flattened set of every category event (for fast membership tests). */
export const ALL_FEATURE_EVENTS = new Set<string>(Object.values(FEATURE_CATEGORIES).flat());

/** Every primary action name used by cross-feature comparison. */
export const ALL_PRIMARY_FEATURE_EVENTS = new Set<string>(
  Object.values(FEATURE_DEFINITIONS).flatMap((definition) => [...definition.primaryActionEvents]),
);

/** Reverse lookup: canonical event name → category. */
export const EVENT_TO_CATEGORY = new Map<string, FeatureCategory>();
for (const [category, events] of Object.entries(FEATURE_CATEGORIES)) {
  for (const event of events) {
    EVENT_TO_CATEGORY.set(event, category as FeatureCategory);
  }
}

/** Categorize a (possibly legacy) event name, or null if it isn't a feature event. */
export function categorizeEvent(eventName: string): FeatureCategory | null {
  return EVENT_TO_CATEGORY.get(normalizeEventName(eventName)) ?? null;
}

/** Property-aware guard for activity events that can contain failed outcomes. */
export function isFeatureActivityEvent(event: MixpanelEvent): boolean {
  const canonical = normalizeEventName(event.event);
  const category = EVENT_TO_CATEGORY.get(canonical);
  if (!category) return false;
  if (canonical === 'Connector_Operation_Used') {
    return event.properties.status === 'completed';
  }
  return true;
}

/** Whether an event contributes to a category's comparable primary-action count. */
export function isPrimaryFeatureEvent(
  category: FeatureCategory,
  event: MixpanelEvent,
): boolean {
  const canonical = normalizeEventName(event.event);
  const definition = FEATURE_DEFINITIONS[category];
  if (!(definition.primaryActionEvents as readonly string[]).includes(canonical)) return false;
  if (canonical === 'Connector_Operation_Used') {
    return event.properties.status === 'completed';
  }
  if (canonical === 'Memory_Toggled') {
    const enabled = event.properties.enabled;
    return enabled === true || enabled === 1 || enabled === 'true' || enabled === '1';
  }
  return true;
}

/**
 * The "key creator actions" that define an Active Creator / activation.
 * Automation_Created + inbox_capture_created added July 2026 — expect a
 * step-change in Weekly Active Creators / activation rate from that date.
 */
export const KEY_ACTION_EVENTS = [
  'Search_Performed',
  'Note_Created',
  'Artifact_Created',
  'Research_Report_Initiated',
  'Collection_Created',
  'Automation_Created',
  'inbox_capture_created',
];
