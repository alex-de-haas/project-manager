// Pure date/hour math behind the carried-over overtime balance.
//
// Everything here works on `YYYY-MM-DD` strings interpreted as UTC calendar days: the balance
// spans years of history, and anchoring the arithmetic to UTC keeps a DST transition from adding
// or dropping an hour in the middle of a range. Nothing in this module iterates a range day by
// day — the business-day count is arithmetic — so a decade of history costs the same as a week.

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface BalanceRange {
  /** First day counted, inclusive. */
  startInclusive: string;
  /** First day *not* counted. */
  endExclusive: string;
}

export interface ExpectedHoursInput {
  businessDays: number;
  fullDayOffs: number;
  halfDayOffs: number;
  dayLength: number;
}

export const isIsoDate = (value: unknown): value is string =>
  typeof value === "string" && ISO_DATE_PATTERN.test(value) && !Number.isNaN(toUtcMs(value));

function toUtcMs(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  // Date.UTC normalizes overflow (2026-02-31 -> March 3), so round-trip to reject invalid days.
  return fromUtcMs(timestamp) === date ? timestamp : Number.NaN;
}

function fromUtcMs(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export const addDays = (date: string, days: number): string =>
  fromUtcMs(toUtcMs(date) + days * DAY_IN_MS);

export const minDate = (left: string, right: string): string => (left <= right ? left : right);

/** Monday–Friday days inside `[startInclusive, endExclusive)`. */
export const countBusinessDays = (startInclusive: string, endExclusive: string): number => {
  const totalDays = Math.round((toUtcMs(endExclusive) - toUtcMs(startInclusive)) / DAY_IN_MS);
  if (!Number.isFinite(totalDays) || totalDays <= 0) {
    return 0;
  }

  // Whole weeks contribute five business days each; only the <7-day tail depends on the weekday
  // the range starts on, so the loop below runs at most six times regardless of range length.
  const firstWeekday = new Date(toUtcMs(startInclusive)).getUTCDay();
  let businessDays = Math.floor(totalDays / 7) * 5;

  for (let offset = 0; offset < totalDays % 7; offset += 1) {
    const weekday = (firstWeekday + offset) % 7;
    if (weekday !== 0 && weekday !== 6) {
      businessDays += 1;
    }
  }

  return businessDays;
};

/**
 * First day *after* the balance carried into the period starting on `periodStart`: the period
 * start itself, or the day after today when the period has not begun yet.
 */
export const resolveCutoff = (periodStart: string, today: string): string =>
  minDate(periodStart, addDays(today, 1));

/**
 * Days that count towards the balance carried into the period starting on `periodStart`.
 *
 * The range ends at the period start, or after today when the period is still in the future —
 * days nobody could have tracked yet must not be reported as a deficit. Returns `null` when
 * nothing has been tracked yet or the whole range sits after the cutoff.
 */
export const resolveBalanceRange = (
  periodStart: string,
  today: string,
  baselineDate: string | null
): BalanceRange | null => {
  if (!baselineDate) {
    return null;
  }

  const endExclusive = resolveCutoff(periodStart, today);
  return baselineDate < endExclusive ? { startInclusive: baselineDate, endExclusive } : null;
};

/** Hours the schedule expected over a range; weekend day-offs must already be filtered out. */
export const computeExpectedHours = ({
  businessDays,
  fullDayOffs,
  halfDayOffs,
  dayLength,
}: ExpectedHoursInput): number => {
  const workedDays = businessDays - fullDayOffs - halfDayOffs * 0.5;
  return Math.max(workedDays, 0) * dayLength;
};

export interface OvertimeDay {
  /** Calendar day as YYYY-MM-DD. */
  key: string;
  isWeekend: boolean;
  isDayOff: boolean;
  isHalfDay: boolean;
  actualHours: number;
}

export interface AccumulateOvertimeInput {
  days: OvertimeDay[];
  /** Balance carried into the first day of the range. */
  openingBalance: number;
  /** The user's first tracked day; days before it are outside the balance entirely. */
  firstTrackedDate: string | null;
  todayKey: string;
  dayLength: number;
}

/**
 * Running balance for each day of a period, continuing from `openingBalance`.
 *
 * The three days that contribute nothing are the same three the server leaves out of the opening
 * balance it hands back for the next period: days after today, days before the user ever tracked
 * anything, and the expectation-free part of weekends and days off. Keeping the two in step is
 * what makes the last figure of one period equal the balance the next period opens with.
 */
export const accumulateOvertime = ({
  days,
  openingBalance,
  firstTrackedDate,
  todayKey,
  dayLength,
}: AccumulateOvertimeInput): number[] => {
  let cumulative = openingBalance;

  return days.map((day) => {
    if (day.key > todayKey) {
      return cumulative;
    }
    if (!firstTrackedDate || day.key < firstTrackedDate) {
      return cumulative;
    }

    const expectedHours = day.isWeekend
      ? 0
      : day.isDayOff
      ? day.isHalfDay
        ? dayLength / 2
        : 0
      : dayLength;

    cumulative += day.actualHours - expectedHours;
    return cumulative;
  });
};
