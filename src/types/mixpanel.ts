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

export interface WebOnboardingMetrics {
  started: number;
  completed: number;
  skipped: number;
  completionRate: number;
  skipRate: number;
  avgCompletionTime: number | null;
  intentDistribution: { intent: string; count: number }[];
  skipStepDistribution: { step: string; count: number }[];
  stepCompletionFunnel: FunnelStep[];
}

export interface AcquisitionFunnelMetrics {
  platform: 'web' | 'ios' | 'macOS';
  subtitle: string;
  funnel: FunnelStep[];
  statCards: { label: string; value: number }[];
  dailyData: Record<string, string | number>[];
  dailyLines: { key: string; color: string; name: string }[];
  webOnboarding?: WebOnboardingMetrics;
  topPages?: { page: string; visits: number }[];
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
  // model-mix + reliability extension
  modelsOverTime?: { date: string; [model: string]: string | number }[];
  topModels?: string[];
  responseTimes?: { model: string; p50: number; p90: number; count: number }[];
  searchFailRate?: number;
  failedCount?: number;
  dataUnavailable?: boolean;
}

export interface FunnelMetrics {
  funnel: FunnelStep[];
  revenueByPlan: { plan: string; revenue: number; count: number; estimated?: boolean }[];
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
  featureOverTime: { date: string;[key: string]: string | number }[];
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
  reportTypeOverTime: { date: string;[key: string]: string | number }[];
  tonePreferences: { name: string; value: number }[];
  citationFormatPreferences: { format: string; count: number }[];
  exportFormatDistribution: { name: string; value: number }[];
  averageSourceCount: number;
  averageWordCount: number;
  dataUnavailable?: boolean;
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
  dataUnavailable?: boolean;
  lastUpdated: string;
}

export interface SharingMetrics {
  totalNotesShared: number;
  totalConversationsShared: number;
  totalResearchShared: number;
  totalCollectionsShared: number;
  totalSharedNoteViews: number;
  totalSharedConversationViews: number;
  totalSharedCollectionViews: number;
  totalSharedResearchViews: number;
  totalSaveToChunkClicks: number;
  noteSharedTrend: number | null;
  conversationSharedTrend: number | null;
  researchSharedTrend: number | null;
  totalSharesTrend: number | null;
  sharedViewsTrend: number | null;
  saveClickTrend: number | null;
  viewToShareRatio: number;
  saveToChunkClickRate: number;
  sharesCreatedOverTime: { date: string; note: number; conversation: number; research: number; collection: number }[];
  sharedViewsOverTime: { date: string; note: number; conversation: number; research: number; collection: number }[];
  sharingFunnel: FunnelStep[];
  contentTypeDistribution: { name: string; value: number }[];
  viewToShareByType: { type: string; shares: number; views: number; ratio: number }[];
  dataUnavailable?: boolean;
  lastUpdated: string;
}

export interface ConnectorsMetrics {
  totalConnectStarted: number;
  totalConnectSucceeded: number;
  totalConnectFailed: number;
  totalDisconnected: number;
  totalDisconnectFailed: number;
  totalStatusDegraded: number;
  totalSettingsViewed: number;
  uniqueSettingsViewers: number;
  totalOperations: number;
  totalOperationsFailed: number;
  uniqueConnectedUsers: number;
  connectSuccessRate: number;
  oauthCallbackSuccessRate: number;
  // True only on a genuine Mixpanel fetch failure (no fresh data and no stale
  // cache) — lets the UI show "data unavailable" instead of misleading zeros.
  dataUnavailable?: boolean;
  connectStartedTrend: number | null;
  connectSucceededTrend: number | null;
  operationsTrend: number | null;
  connectorsFunnel: FunnelStep[];
  connectorBreakdown: { name: string; value: number }[];
  operationBreakdown: { connector: string; operation: string; count: number }[];
  dailyActivity: { date: string; connects: number; operations: number; disconnects: number }[];
  topErrors: { error: string; count: number }[];
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
  dataUnavailable?: boolean;
  lastUpdated: string;
}

export interface ArtifactsMetrics {
  totalCreated: number;
  totalCompleted: number;
  totalFailed: number;
  totalViewed: number;
  totalDeleted: number;
  totalSavedToNotes: number;
  totalVisualsGenerated: number;
  totalBatchStarted: number;
  totalFileUploads: number;
  uniqueArtifactUsers: number;
  completionRate: number;
  createdTrend: number | null;
  completedTrend: number | null;
  viewedTrend: number | null;
  savedToNotesTrend: number | null;
  fileUploadsTrend: number | null;
  artifactsFunnel: FunnelStep[];
  dailyData: { date: string; created: number; completed: number; viewed: number }[];
  sourceTypeDistribution: { name: string; value: number }[];
  outputTypeDistribution: { name: string; value: number }[];
  tabSwitchDistribution: { name: string; value: number }[];
  savedContentTypeDistribution: { name: string; value: number }[];
  fileTypeDistribution: { name: string; value: number }[];
  onboardingFunnel: FunnelStep[];
  dataUnavailable?: boolean;
  lastUpdated: string;
}

// ============================================
// New consolidated dashboard types
// ============================================

export interface RevenueSummary {
  mrr: number;
  mrrChange: number;
  arr: number;
  todayRevenue: number;
  totalSubscribers: number;
  trialUsers: number;
  churnRate: number;
  byPlatform: Record<string, number>;
  byProduct: Record<string, number>;
  /** Real active-subscriber head-count per plan type (monthly/annual). */
  subscribersByProduct?: Record<string, number>;
  mrrTrend: { date: string; mrr: number }[];
  newSubscribers: number;
  churned: number;
  netNew: number;
  lastUpdated: string;
  note?: string;
}

export interface SubscriberFunnel {
  funnel: { stage: string; count: number; rate: number }[];
  trialConversionRate: number;
  medianDaysToConvert: number;
  conversionByPlatform: Record<string, number>;
  weekOverWeek: { trialStarts: number; conversions: number };
  lastUpdated: string;
  note?: string;
}

export interface ChurnIntelligence {
  churnRate: number;
  churnRateTrend: { date: string; rate: number }[];
  atRiskUsers: {
    uid: string;
    email: string;
    lastActive: string;
    daysSinceActive: number | null;
    healthScore: number;
    subscriptionAge: number | null;
    platform: string;
    subscriptionType: 'active' | 'trial';
    trialEndsIn?: number | null;
  }[];
  churnedUsers: {
    uid: string;
    email: string;
    churnDate: string;
    tenure: number;
    reason: string;
    emailsReceived: string[];
    emailsOpened: string[];
    platform: string;
    usage: { searches: number; notes: number };
  }[];
  topEngagedUsers: {
    uid: string;
    email: string;
    lastActive: string;
    daysSinceActive: number;
    healthScore: number;
    subscriptionAge: number | null;
    platform: string;
    usage: { searches: number; documents: number; notes: number; collections: number };
    factors: { recency: number; frequency: number; featureDepth: number; tenure: number; emailEngagement: number };
  }[];
  winbackEffectiveness: Record<string, { sent: number; recovered: number; rate: number }>;
  churnReasons: Record<string, number>;
  avgTenureBeforeChurn: number;
  atRiskCount: number;
  trialAtRiskCount: number;
  winbackRate: number;
  engagedCount: number;
  lastUpdated: string;
  note?: string;
  dataUnavailable?: boolean;
}

export interface AdvancedMetrics {
  dauMauRatio: number;
  avgDAU: number;
  mau: number;
  avgSessionDuration: number;
  searchesPerUser: number;
  retention: { day1: number; day7: number; day30: number; totalNewUsers?: number };
  userBreakdown: { total?: number; paid: number; free: number; guest: number; authenticated?: number; paidPercentage?: number; conversionRate?: number };
  featureAdoption: { feature: string; users?: number; rate?: number; adoptionRate?: number }[];
  trafficSources: { source: string; sessions?: number; count?: number }[];
  utmSources: { source?: string; campaign?: string; sessions?: number; count?: number }[];
  lastUpdated: string;
}

export interface TopMover {
  category: string;
  current: number;
  previous: number;
  change: number | null;
}

export interface PulseMetrics {
  todayDAU: number;
  yesterdayDAU: number;
  todaySearches: number;
  dauTrend7d: { date: string; users: number }[];
  // v2 fields
  sameWeekdayDAU: number;
  dauTrend14d: { date: string; users: number }[];
  weeklyActiveCreators: number;
  weeklyActiveCreatorsPrev: number;
  wacChange: number | null;
  todaySignups: number;
  todayTrialStarts: number;
  todayPurchases: number;
  todayPurchaseFailures: number;
  todayPaywallViews: number;
  searchFailRateToday: number;
  searchFailRate7d: number;
  microFunnel: {
    paywallViewed: number;
    planSelected: number;
    purchaseInitiated: number;
    purchaseCompleted: number;
  };
  topMovers: { gainers: TopMover[]; decliners: TopMover[] };
  lastUpdated: string;
}

export interface SentryStats {
  projects: { slug: string; label: string; platform: string; totalEvents: number; totalFiltered: number }[];
  totalErrors: number;
  errorTrend: { date: string; errors: number }[];
  lastUpdated: string;
  error?: string;
}

export interface FeatureOverviewMetrics {
  features: {
    name: string;
    totalEvents: number;
    uniqueUsers: number;
    trend: number | null;
    /** DAU/MAU ratio for this feature (0–1) — added by the stickiness extension. */
    stickiness?: number;
    /** Share of active users who used this feature (0–1). */
    adoptionRate?: number;
  }[];
  memoryEnabled: {
    uniqueUsers: number;
    trend: number | null;
  };
  // True only on a genuine Mixpanel fetch failure (no fresh data and no stale
  // cache) — lets the UI show "data unavailable" instead of misleading zeros.
  dataUnavailable?: boolean;
  lastUpdated: string;
}

export interface CustomerHealthFactors {
  recency: number;
  frequency: number;
  featureDepth: number;
  tenure: number;
  emailEngagement: number;
}

export interface CustomerHealthEntry {
  uid: string;
  email: string;
  name?: string;
  platform: string;
  healthScore: number;
  healthStatus: 'healthy' | 'atRisk' | 'churning' | string;
  subscriptionStatus: string;
  subscribedDays: number;
  lastActiveAt: string;
  factors: CustomerHealthFactors;
}

export interface CustomerHealth {
  distribution: { healthy: number; atRisk: number; churning: number };
  customers: CustomerHealthEntry[];
  averageHealthScore: number;
  lastUpdated: string;
  note?: string;
}

export interface CustomerDetail {
  uid: string;
  email: string;
  name?: string;
  platform: string;
  healthScore: number;
  healthFactors?: CustomerHealthFactors;
  subscriptionStatus: string;
  createdAt: string;
  lastActiveAt: string;
  usageStats: {
    monthlySearches?: number;
    monthlyDocuments?: number;
    monthlyImages?: number;
    monthlyNotes?: number;
    monthlyCollections?: number;
  };
  emailHistory: {
    emailType?: string;
    sentAt?: string;
    delivered?: boolean;
    opened?: boolean;
    clicked?: boolean;
    converted?: boolean;
  }[];
  subscriptionHistory: {
    event?: string;
    status?: string;
    date?: string;
    timestamp?: string;
    platform?: string;
  }[];
  lastUpdated: string;
  error?: string;
}

export interface ActivationMetrics {
  activationRate: number;
  eligibleSignups: number;
  activatedCount: number;
  medianMinutesToFirstAction: number | null;
  funnel: FunnelStep[];
  firstActionMix: { name: string; value: number }[];
  timeToFirstAction: { bucket: string; count: number }[];
  byPlatform: { name: string; signups: number; activated: number; rate: number }[];
  bySignupMethod: { name: string; signups: number; activated: number; rate: number }[];
  onboarding: { completed: { signups: number; rate: number }; skipped: { signups: number; rate: number } };
  weeklyTrend: { week: string; signups: number; rate: number }[];
  dateRange: DateRange;
  lastUpdated: string;
}

export interface CaptureMonitorsMetrics {
  monitorsCreated: number;
  capturesTotal: number;
  keepRate: number;
  activeSources: number;
  cadenceMix: { name: string; value: number }[];
  reportTypeMix: { name: string; value: number }[];
  topTopics: { topic: string; count: number }[];
  monitorsByPlatform: { name: string; value: number }[];
  capturesBySource: { name: string; value: number }[];
  capturesByContentType: { name: string; value: number }[];
  triageFunnel: FunnelStep[];
  triageOutcomes: { name: string; value: number }[];
  dailyTrend: { date: string; monitors: number; captures: number }[];
  // Automation lifecycle + funnel
  kindMix: { name: string; value: number }[];
  lifecycleActions: { name: string; value: number }[];
  runStatusMix: { name: string; value: number }[];
  kindSelectSource: { name: string; value: number }[];
  planStepMix: { name: string; value: number }[];
  topRecipes: { recipe: string; count: number }[];
  suggestionFunnel: FunnelStep[];
  suggestionOutcomes: { name: string; value: number }[];
  suggestionAcceptRate: number;
  runsViewed: number;
  limitHits: number;
  paywallsShown: number;
  deletedCount: number;
  avgRunsBeforeDelete: number;
  // Capture setup + engagement
  captureSetup: { name: string; value: number }[];
  inboxViews: number;
  dateRange: DateRange;
  lastUpdated: string;
}

export interface RetentionCohortMetrics {
  weeks: number;
  cohorts: { week: string; size: number; retention: (number | null)[] }[];
  curve: { week: number; retention: number }[];
  totalSignups: number;
  dateRange: DateRange;
  lastUpdated: string;
}

export interface ViralityMetrics {
  kpis: {
    sharesCreated: number;
    sharedViews: number;
    saveClicks: number;
    viralSignups: number;
    viewsPerShare: number;
    saveRate: number;
  };
  funnel: FunnelStep[];
  byType: { type: string; shares: number; views: number; viewsPerShare: number }[];
  dailyData: { date: string; shares: number; views: number; saves: number }[];
  dateRange: DateRange;
  lastUpdated: string;
}

export interface ReliabilityMetrics {
  kpis: {
    searchFailRate: number;
    artifactFailRate: number;
    imageFailRate: number;
    purchaseFailures: number;
    searchFailed: number;
    artifactFailed: number;
    imageFailed: number;
  };
  dailyData: { date: string; searchFailRate: number; errors: number }[];
  topErrors: { error: string; count: number }[];
  connectorDegradations: { connector: string; count: number }[];
  dateRange: DateRange;
  lastUpdated: string;
}

export interface PowerUserMetrics {
  totalUsers: number;
  segments: { segment: string; count: number; subscribers: number; description: string }[];
  topUsers: { uid: string; activeDays: number; features: number; events: number; subscriber: boolean }[];
  featureBreadth: { features: string; users: number }[];
  dateRange: DateRange;
  lastUpdated: string;
}

export interface MonetizationMetrics {
  funnel: FunnelStep[];
  kpis: {
    paywallViews: number;
    purchases: number;
    overallConversion: number;
    dismissalRate: number;
    failures: number;
    cancellations: number;
  };
  byPlatform: { platform: string; views: number; purchases: number; conversion: number }[];
  planMix: { name: string; value: number }[];
  paywallSources: { source: string; count: number }[];
  featureLimits: { feature: string; count: number }[];
  dailyData: { date: string; paywallViewed: number; planSelected: number; purchaseStarted: number; purchased: number }[];
  dateRange: DateRange;
  lastUpdated: string;
}

export interface HelpCenterMetrics {
  totalViews: number;
  uniqueUsers: number;
  faqOpens: number;
  ctaClicks: number;
  viewsTrend: number | null;
  uniqueUsersTrend: number | null;
  faqOpensTrend: number | null;
  ctaClicksTrend: number | null;
  pageViewDistribution: { page: string; count: number }[];
  faqCategoryDistribution: { category: string; count: number }[];
  topFaqQuestions: { question: string; category: string; count: number }[];
  navDestinations: { destination: string; count: number }[];
  dailyData: { date: string; views: number; faqOpens: number; ctaClicks: number }[];
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
  pageViews: number;
  pagesPerSession: number;
  newVisitors: number;
  ctaClicksTrend: number | null;
  featurePagesTrend: number | null;
  guestPromptsTrend: number | null;
  paywallDismissalsTrend: number | null;
  pageViewsTrend: number | null;
  ctaSourceDistribution: { source: string; count: number }[];
  featurePageDistribution: { page: string; count: number }[];
  featureLimitDistribution: { feature: string; count: number }[];
  guestPromptSourceDistribution: { source: string; count: number }[];
  pageViewDistribution: { page: string; views: number; visitors: number }[];
  referrerDistribution: { source: string; sessions: number }[];
  utmSourceDistribution: { source: string; sessions: number }[];
  utmMediumDistribution: { source: string; sessions: number }[];
  utmCampaignDistribution: { source: string; sessions: number }[];
  dailyData: { date: string; tryFree: number; createAccount: number; featurePages: number; guestPrompts: number }[];
  newVisitorsDaily: { date: string; newVisitors: number }[];
  marketingCTAFunnel: FunnelStep[];
  lastUpdated: string;
}
