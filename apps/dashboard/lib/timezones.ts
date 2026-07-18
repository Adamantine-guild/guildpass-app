/** Shared IANA timezones offered by the settings UI and accepted by the API. */
const FALLBACK_TIMEZONES = [
  "UTC", "Africa/Cairo", "Africa/Johannesburg", "Africa/Lagos", "Africa/Nairobi",
  "America/Anchorage", "America/Argentina/Buenos_Aires", "America/Bogota",
  "America/Chicago", "America/Denver", "America/Halifax", "America/Los_Angeles",
  "America/Mexico_City", "America/New_York", "America/Phoenix", "America/Sao_Paulo",
  "America/Toronto", "America/Vancouver", "Asia/Bangkok", "Asia/Dubai",
  "Asia/Hong_Kong", "Asia/Jakarta", "Asia/Jerusalem", "Asia/Kolkata", "Asia/Seoul",
  "Asia/Shanghai", "Asia/Singapore", "Asia/Tokyo", "Australia/Adelaide",
  "Australia/Brisbane", "Australia/Melbourne", "Australia/Perth", "Australia/Sydney",
  "Europe/Amsterdam", "Europe/Athens", "Europe/Berlin", "Europe/Brussels",
  "Europe/Dublin", "Europe/Helsinki", "Europe/Istanbul", "Europe/Lisbon",
  "Europe/London", "Europe/Madrid", "Europe/Moscow", "Europe/Paris", "Europe/Prague",
  "Europe/Rome", "Europe/Stockholm", "Europe/Vienna", "Europe/Warsaw",
  "Pacific/Auckland", "Pacific/Fiji", "Pacific/Honolulu",
] as const;

type IntlWithSupportedValues = typeof Intl & {
  supportedValuesOf?: (key: "timeZone") => string[];
};

function getSupportedTimezones(): readonly string[] {
  const supportedValuesOf = (Intl as IntlWithSupportedValues).supportedValuesOf;
  if (typeof supportedValuesOf !== "function") return FALLBACK_TIMEZONES;
  try {
    // UTC is valid but omitted by some implementations of supportedValuesOf.
    return ["UTC", ...supportedValuesOf("timeZone").filter((timezone) => timezone !== "UTC")];
  } catch {
    return FALLBACK_TIMEZONES;
  }
}

export const SUPPORTED_TIMEZONES = Object.freeze(getSupportedTimezones());
