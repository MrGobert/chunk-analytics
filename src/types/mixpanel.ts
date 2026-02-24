export interface MixpanelEvent {
  event: string;
  properties: {
    time: number;
    distinct_id: string;
    $insert_id?: string;
    $model?: string;
    $os?: string;
    $os_version?: string;
    $manufacturer?: string;
    $city?: string;
    $region?: string;
    mp_country_code?: string;
    platform?: string;
    model_used?: string;
    search_mode?: string;
    has_context?: boolean;
    plan_type?: string;
    price?: number;
    product_id?: string;
    has_trial?: boolean;
    source?: string;
    $ae_session_length?: number;
    tab_name?: string;
    step?: string;
    error_message?: string;
    [key: string]: unknown;
  };
}

export type UserType = 'all' | 'authenticated' | 'subscribers' | 'visitors';

export interface UserBreakdown {
  total: number;
  visitors: number;
  authenticated: number;
  subscribers: number;
}

export interface OverviewMetrics {
  totalUsers: number;
  totalSessions: number;
  marketingSessions: number;
  appSessions: number;
  totalSearches: number;
  conversionRate: number;
  usersTrend: number | null;
  sessionsTrend: number | null;
  marketingSessionsTrend: number | null;
  appSessionsTrend: number | null;
  searchesTrend: number | null;
  dailyData: DailyDataPoint[];
  userType?: UserType;
  userBreakdown?: UserBreakdown;
}

export interface DailyDataPoint {
  date: string;
  users: number;
  sessions: number;
  marketingSessions: number;
  appSessions: number;
  searches: number;
  [key: string]: string | number;
}

export interface AcquisitionFunnelMetrics {
  funnel: FunnelStep[];
  dailyData: { date: string; marketing: number; guest: number; signup: number; subscriber: number }[];
  conversionRates: {
    marketingToGuest: number;
    guestToSignup: number;
    signupToSubscriber: number;
    overallMarketingToSubscriber: number;
  };
  lastUpdated: string;
}

export interface UserMetrics {
  dau: DailyDataPoint[];
  wau: WeeklyDataPoint[];
  mau: MonthlyDataPoint[];
  sessionDurations: SessionDuration[];
  sessionsPerUser: SessionsPerUser[];
  geographic: GeographicData[];
}

export interface WeeklyDataPoint {
  week: string;
  users: number;
  [key: string]: string | number;
}

export interface MonthlyDataPoint {
  month: string;
  users: number;
  [key: string]: string | number;
}

export interface SessionDuration {
  range: string;
  count: number;
  [key: string]: string | number;
}

export interface SessionsPerUser {
  sessions: string;
  users: number;
  [key: string]: string | number;
}

export interface GeographicData {
  country: string;
  users: number;
  percentage: number;
  [key: string]: string | number;
}

export interface SearchMetrics {
  searchesOverTime: DailyDataPoint[];
  searchModes: { mode: string; count: number }[];
  modelsUsed: { model: string; count: number }[];
  contextUsage: { hasContext: boolean; count: number }[];
  hourlyDistribution: { hour: number; count: number }[];
}

export interface FunnelMetrics {
  funnel: FunnelStep[];
  revenueByPlan: { plan: string; revenue: number; count: number }[];
  trialConversion: { converted: number; notConverted: number };
  failedPurchases: { error: string; count: number }[];
  paywallSources: { source: string; count: number }[];
  paywallDismissed: number;
  purchaseCancelled: number;
}

export interface FunnelStep {
  name: string;
  count: number;
  percentage: number;
  dropoff: number;
}

export interface FeatureMetrics {
  featureUsage: { feature: string; count: number }[];
  featureOverTime: { date: string; [key: string]: string | number }[];
  featuresBySegment: { segment: string; features: { feature: string; count: number }[] }[];
}

export interface DateRange {
  from: string;
  to: string;
}

export interface PushMetrics {
  permissionRequested: number;
  permissionGranted: number;
  permissionDenied: number;
  notificationsOpened: number;
  optInRate: number;
  usersWithOpens: number;
  requestedTrend: number | null;
  grantedTrend: number | null;
  openedTrend: number | null;
  dailyData: PushDailyDataPoint[];
  destinations: PushDestination[];
  sources: PushSource[];
  permissionFunnel: FunnelStep[];
  hourlyDistribution: HourlyDataPoint[];
  lastUpdated: string;
}

export interface PushDailyDataPoint {
  date: string;
  requested: number;
  granted: number;
  denied: number;
  opened: number;
}

export interface PushDestination {
  destination: string;
  count: number;
}

export interface PushSource {
  source: string;
  count: number;
}

export interface HourlyDataPoint {
  hour: number;
  count: number;
}

export interface ResearchMetrics {
  totalReportsInitiated: number;
  totalReportsCompleted: number;
  completionRate: number;
  totalReportsViewed: number;
  totalExports: number;
  totalShares: number;
  uniqueResearchUsers: number;
  initiatedTrend: number | null;
  completedTrend: number | null;
  viewedTrend: number | null;
  exportsTrend: number | null;
  sharesTrend: number | null;
  reportTypeDistribution: { name: string; value: number }[];
  researchFunnel: FunnelStep[];
  dailyData: { date: string; initiated: number; completed: number; viewed: number }[];
  reportTypeOverTime: { date: string; [key: string]: string | number }[];
  tonePreferences: { name: string; value: number }[];
  citationFormatPreferences: { format: string; count: number }[];
  exportFormatDistribution: { name: string; value: number }[];
  averageSourceCount: number;
  averageWordCount: number;
  lastUpdated: string;
}

export interface NotesMetrics {
  totalNotesCreated: number;
  totalNotesViewed: number;
  totalNotesSaved: number;
  totalNotesDeleted: number;
  totalPublished: number;
  totalShared: number;
  totalDocumentUploads: number;
  uniqueNoteUsers: number;
  totalWritingToolUses: number;
  createdTrend: number | null;
  viewedTrend: number | null;
  savedTrend: number | null;
  publishedTrend: number | null;
  sharedTrend: number | null;
  writingToolTrend: number | null;
  notesFunnel: FunnelStep[];
  dailyData: { date: string; created: number; viewed: number; saved: number }[];
  saveTriggerDistribution: { name: string; value: number }[];
  writingToolDistribution: { name: string; value: number }[];
  featureAdoption: { name: string; value: number }[];
  retentionRate: number;
  documentUploadRate: number;
  lastUpdated: string;
}

export interface SharingMetrics {
  totalNotesShared: number;
  totalConversationsShared: number;
  totalResearchShared: number;
  totalCollectionsShared: number;
  totalSharedNoteViews: number;
  totalSharedConversationViews: number;
  totalSharedResearchViews: number;
  totalSaveToChunkClicks: number;
  noteSharedTrend: number | null;
  conversationSharedTrend: number | null;
  researchSharedTrend: number | null;
  sharedViewsTrend: number | null;
  saveClickTrend: number | null;
  viewToShareRatio: number;
  saveToChunkClickRate: number;
  sharesCreatedOverTime: { date: string; note: number; conversation: number; research: number; collection: number }[];
  sharedViewsOverTime: { date: string; note: number; conversation: number; research: number }[];
  sharingFunnel: FunnelStep[];
  contentTypeDistribution: { name: string; value: number }[];
  viewToShareByType: { type: string; shares: number; views: number; ratio: number }[];
  lastUpdated: string;
}

export interface CollectionsMetrics {
  totalCreated: number;
  totalViewed: number;
  totalUpdated: number;
  totalDeleted: number;
  totalURLsAdded: number;
  totalURLsRemoved: number;
  totalChatStarted: number;
  totalExported: number;
  totalShared: number;
  uniqueCollectionUsers: number;
  createdTrend: number | null;
  viewedTrend: number | null;
  chatStartedTrend: number | null;
  exportedTrend: number | null;
  sharedTrend: number | null;
  collectionsFunnel: FunnelStep[];
  dailyData: { date: string; created: number; viewed: number; chatStarted: number; exported: number }[];
  urlManagement: { date: string; added: number; removed: number }[];
  lastUpdated: string;
}

export interface MarketingMetrics {
  totalCTAClicks: number;
  tryForFreeClicks: number;
  createAccountClicks: number;
  featurePagesVisited: number;
  guestSignupPrompts: number;
  paywallDismissals: number;
  featureLimitReached: number;
  marketingSessions: number;
  ctaClicksTrend: number | null;
  featurePagesTrend: number | null;
  guestPromptsTrend: number | null;
  paywallDismissalsTrend: number | null;
  ctaSourceDistribution: { source: string; count: number }[];
  featurePageDistribution: { page: string; count: number }[];
  featureLimitDistribution: { feature: string; count: number }[];
  guestPromptSourceDistribution: { source: string; count: number }[];
  dailyData: { date: string; tryFree: number; createAccount: number; featurePages: number; guestPrompts: number }[];
  marketingCTAFunnel: FunnelStep[];
  lastUpdated: string;
}
