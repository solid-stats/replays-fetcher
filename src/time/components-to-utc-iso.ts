type UtcDateComponents = {
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly month: number;
  readonly second?: number;
  readonly year: number;
};

const padTwo = (value: number): string => String(value).padStart(2, "0");
const padFour = (value: number): string => String(value).padStart(4, "0");

/**
 * Range-validate calendar components and render them as a UTC ISO string, or
 * return undefined when any component is out of range. Validation round-trips
 * through `Date.UTC` and confirms every component survives — this catches both
 * never-valid fields (month 13, day 32, hour 25) and calendar rollover where
 * each field is in 2-digit range but the date does not exist (e.g. 31.04, the
 * 31st of a 30-day April). Both timestamp parsers feed external, attacker-
 * influenceable source data here, so an in-shape-but-invalid date must fall
 * through to undefined rather than ship a bogus `timestamptz` value.
 */
export const componentsToUtcIso = (
  components: UtcDateComponents,
): string | undefined => {
  const { day, hour, minute, month, second = 0, year } = components;
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(ms);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return undefined;
  }

  return `${padFour(year)}-${padTwo(month)}-${padTwo(day)}T${padTwo(hour)}:${padTwo(minute)}:${padTwo(second)}.000Z`;
};
