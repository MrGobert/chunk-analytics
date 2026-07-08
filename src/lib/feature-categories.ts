import { normalizeEventName } from '@/lib/mixpanel';

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
 *   Monitor_Limit_Hit, Monitor_Paywall_Shown,
 *   Monitor_Suggestion_Shown/Accepted/Dismissed, Automation_Kind_Selected,
 *   Automation_Recipe_Selected, Automation_Plan_Previewed, inbox_viewed,
 *   inbox_clipper_token_generated/revoked,
 *   inbox_email_alias_generated/disabled (friction/paywall/composer/passive
 *   events — all still on the capture-monitors detail route).
 *
 * Note: Capture events are intentionally snake_case — those are the frozen
 * production names (emitted server-side by cerebral / client triage), no
 * normalization applies.
 */
export const FEATURE_CATEGORIES: Record<string, string[]> = {
  Search: ['Search_Performed'],
  Research: ['Research_Report_Initiated', 'Research_Report_Completed', 'Research_Report_Viewed', 'Research_Report_Exported', 'Research_Report_Shared', 'Research_Report_Deleted', 'Research_Report_Added_To_Collection', 'Research_Published'],
  Notes: ['Note_Created', 'Note_Viewed', 'Note_Saved', 'Note_Shared', 'Note_Published', 'Note_Writing_Tool_Used', 'Note_Uploaded_To_Documents', 'Note_Deleted'],
  Collections: ['Collection_Created', 'Collection_Viewed', 'Collection_Chat_Started', 'Collection_Exported', 'Collection_Shared', 'Collection_URL_Added', 'Collection_Updated', 'Collection_Deleted', 'Collection_URL_Removed'],
  Artifacts: ['Artifact_Created', 'Artifact_Completed', 'Artifact_Viewed', 'Artifact_Saved_To_Notes', 'Artifact_File_Uploaded', 'Artifact_Failed', 'Artifact_Deleted', 'Artifact_Visual_Generated', 'Artifact_Batch_Started', 'Artifact_Batch_Completed'],
  Documents: ['Document_Uploaded', 'Document_Viewed', 'Document_Deleted', 'Document_Attached'],
  'Image Gen': ['Image_Generation_Started', 'Image_Generation_Completed'],
  Memory: ['Memory_Viewed', 'Memory_Toggled', 'Memory_Added', 'Memory_Deleted'],
  Connectors: [
    'Connector_Connect_Started',
    'Connector_Connect_Succeeded',
    'Connector_Connect_Failed',
    'Connector_Disconnected',
    'Connector_OAuth_Callback',
    'Connector_Operation_Used',
    'Connector_Disconnect_Failed',
    'Connector_Status_Degraded',
    'Notion_Search_Used',
    'Notion_Page_Created',
    'Notion_Append_Performed',
    'Gamma_Generation_Started',
    'Gamma_Generation_Completed',
    'Gamma_Generation_Failed',
  ],
  Automations: [
    'Monitor_Created',
    'Monitor_Edited',
    'Monitor_Paused',
    'Monitor_Resumed',
    'Monitor_Deleted',
    'Monitor_RunNow',
    'Monitor_Run_Viewed',
  ],
  Capture: [
    'inbox_capture_created',
    'inbox_item_accepted',
    'inbox_item_discarded',
    'inbox_item_to_collection',
  ],
};

/** Flattened set of every category event (for fast membership tests). */
export const ALL_FEATURE_EVENTS = new Set(Object.values(FEATURE_CATEGORIES).flat());

/** Reverse lookup: canonical event name → category. */
export const EVENT_TO_CATEGORY = new Map<string, string>();
for (const [category, events] of Object.entries(FEATURE_CATEGORIES)) {
  for (const event of events) {
    EVENT_TO_CATEGORY.set(event, category);
  }
}

/** Categorize a (possibly legacy) event name, or null if it isn't a feature event. */
export function categorizeEvent(eventName: string): string | null {
  return EVENT_TO_CATEGORY.get(normalizeEventName(eventName)) ?? null;
}

/**
 * The "key creator actions" that define an Active Creator / activation.
 * Monitor_Created + inbox_capture_created added July 2026 — expect a
 * step-change in Weekly Active Creators / activation rate from that date.
 */
export const KEY_ACTION_EVENTS = [
  'Search_Performed',
  'Note_Created',
  'Artifact_Created',
  'Research_Report_Initiated',
  'Collection_Created',
  'Monitor_Created',
  'inbox_capture_created',
];
