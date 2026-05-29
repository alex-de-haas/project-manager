export const DEFAULT_DAY_LENGTH_SETTING_KEY = "default_day_length";

const FALLBACK_DEFAULT_DAY_LENGTH = 8;
const MIN_DEFAULT_DAY_LENGTH = 0.5;
const MAX_DEFAULT_DAY_LENGTH = 24;

export const parseDefaultDayLength = (value: unknown): number | null => {
  const numericValue = Number(value);

  if (
    !Number.isFinite(numericValue) ||
    numericValue < MIN_DEFAULT_DAY_LENGTH ||
    numericValue > MAX_DEFAULT_DAY_LENGTH
  ) {
    return null;
  }

  return numericValue;
};

export const getModuleDefaultDayLength = () =>
  parseDefaultDayLength(process.env.PROJECT_MANAGER_DEFAULT_DAY_LENGTH) ??
  FALLBACK_DEFAULT_DAY_LENGTH;

