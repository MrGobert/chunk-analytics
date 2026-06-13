import { normalizeEventName } from '@/lib/mixpanel';

/**
 * Map canonical event names to feature categories for cross-feature comparison.
 * All event names here must be canonical — legacy names resolve via
 * normalizeEventName(). Shared by feature-overview, power-users, and Pulse top-movers.
 */
export const FEATURE_CATEGORIES: Record<string, string[]> = {
  Search: ['Search_Performed'],
  Research: ['Research_Report_Initiated', 'Research_Report_Completed', 'Research_Report_Viewed', 'Research_Report_Exported', 'Research_Report_Shared', 'Research_Report_Deleted', 'Research_History_Viewed', 'Research_Settings_Changed', 'Research_Report_Added_To_Collection', 'Research_Report_Filtered', 'Research_Published'],
  Notes: ['Note_Created', 'Note_Viewed', 'Note_Saved', 'Note_Shared', 'Note_Published', 'Note_Writing_Tool_Used', 'Note_Uploaded_To_Documents', 'Note_Deleted'],
  Collections: ['Collection_Created', 'Collection_Viewed', 'Collection_Chat_Started', 'Collection_Exported', 'Collection_Shared', 'Collection_URL_Added', 'Collection_Updated', 'Collection_Deleted', 'Collection_URL_Removed'],
  Artifacts: ['Artifact_Created', 'Artifact_Completed', 'Artifact_Viewed', 'Artifact_Saved_To_Notes', 'Artifact_File_Uploaded', 'Artifact_Failed', 'Artifact_Deleted', 'Artifact_Tab_Switched', 'Artifact_Visual_Generated', 'Artifact_Filtered', 'Artifact_Searched', 'Artifact_Onboarding_Viewed', 'Artifact_Onboarding_Completed', 'Artifact_Onboarding_Skipped', 'Artifact_Batch_Started', 'Artifact_Batch_Completed'],
  Documents: ['Document_Uploaded', 'Document_Viewed', 'Document_Deleted', 'Document_Attached'],
  'Image Gen': ['Image_Generation_Started', 'Image_Generation_Completed'],
  Memory: ['Memory_Viewed', 'Memory_Toggled', 'Memory_Added', 'Memory_Deleted', 'Memory_Management_Viewed'],
  Connectors: [
    'Connector_Connect_Started',
    'Connector_Connect_Succeeded',
    'Connector_Connect_Failed',
    'Connector_Disconnected',
    'Connector_OAuth_Callback',
    'Connector_Operation_Used',
    'Connector_Disconnect_Failed',
    'Connector_Status_Degraded',
    'Connector_Settings_Viewed',
    'Notion_Search_Used',
    'Notion_Page_Created',
    'Notion_Append_Performed',
    'Gamma_Generation_Started',
    'Gamma_Generation_Completed',
    'Gamma_Generation_Failed',
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

/** The "key creator actions" that define an Active Creator / activation. */
export const KEY_ACTION_EVENTS = [
  'Search_Performed',
  'Note_Created',
  'Artifact_Created',
  'Research_Report_Initiated',
  'Collection_Created',
];
