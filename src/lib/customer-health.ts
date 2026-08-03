interface EmailEngagementEvent {
  sentAt?: string;
  delivered?: boolean;
  opened?: boolean;
  clicked?: boolean;
  converted?: boolean;
}

export function emailEngagementScore(
  history: EmailEngagementEvent[],
): number | null {
  const trackable = history.filter(
    (email) => email.sentAt || email.delivered || email.opened || email.clicked,
  );
  if (trackable.length === 0) return null;

  const engaged = trackable.filter(
    (email) => email.opened || email.clicked || email.converted,
  ).length;
  return Math.round(engaged / trackable.length * 100);
}

export function recoverTenureFactor(
  tenure: number,
  recordedRecency: number,
  recoveredRecency: number,
): number {
  if (recordedRecency !== 0 || recoveredRecency <= 0) return tenure;
  return Math.min(100, tenure * 2);
}
