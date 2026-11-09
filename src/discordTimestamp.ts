// Core engine: converts a local date/time into every Discord <t:UNIX:FORMAT> code
// and renders a preview string identical to what Discord's client shows.
// Pure functions, no DOM — reused by the tool UI and by the engine test suite.

export type DiscordFormatCode = 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 's' | 'S' | 'R';

export interface DiscordFormat {
  code: DiscordFormatCode;
  label: string;
  description: string;
  example: string;
}

export const DISCORD_FORMATS: DiscordFormat[] = [
  { code: 't', label: 'Short Time', description: 'Hours and minutes', example: '9:01 PM' },
  { code: 'T', label: 'Long Time', description: 'Hours, minutes and seconds', example: '9:01:00 PM' },
  { code: 'd', label: 'Short Date', description: 'Numeric date', example: '11/28/2018' },
  { code: 'D', label: 'Long Date', description: 'Full month name', example: 'November 28, 2018' },
  {
    code: 'f',
    label: 'Short Date/Time',
    description: "Discord's default when you paste a timestamp",
    example: 'November 28, 2018 at 9:01 PM',
  },
  {
    code: 'F',
    label: 'Long Date/Time',
    description: 'Includes the day of the week',
    example: 'Wednesday, November 28, 2018 at 9:01 PM',
  },
  {
    code: 's',
    label: 'Short Date + Time',
    description: 'Numeric date with hours and minutes',
    example: '11/28/2018, 9:01 PM',
  },
  {
    code: 'S',
    label: 'Short Date + Long Time',
    description: 'Numeric date with seconds',
    example: '11/28/2018, 9:01:00 PM',
  },
  {
    code: 'R',
    label: 'Relative Time',
    description: 'Counts up or down automatically',
    example: '3 years ago',
  },
];

export function buildTimestampCode(unixSeconds: number, code: DiscordFormatCode): string {
  return `<t:${unixSeconds}:${code}>`;
}

// A raw value this large can only be milliseconds — seconds don't reach 11 digits until
// the year 5138, while "now" in milliseconds is already 13 digits.
const MS_THRESHOLD = 100_000_000_000;

/**
 * Parses a raw Unix timestamp typed or pasted by a user (or sent to the API), accepting
 * either seconds or milliseconds and normalizing to whole seconds. Returns null for
 * anything that isn't a plain integer.
 */
export function parseUnixInput(raw: string): { unix: number; wasMs: boolean } | null {
  const trimmed = raw.trim();
  if (!trimmed || !/^-?\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return null;
  const wasMs = Math.abs(value) >= MS_THRESHOLD;
  return { unix: wasMs ? Math.floor(value / 1000) : value, wasMs };
}

// Discord's own epoch (2015-01-01T00:00:00.000Z), distinct from the Unix epoch — the
// first 42 bits of a snowflake are milliseconds since *this*, not since 1970.
const DISCORD_EPOCH_MS = 1420070400000n;

export interface DecodedSnowflake {
  unixMs: number;
  unixSeconds: number;
  workerId: number;
  processId: number;
  increment: number;
}

/**
 * Decodes a Discord snowflake (a message, user, channel, or server ID) into the moment it
 * was created plus its packed internal fields. Snowflakes exceed JS's safe integer range,
 * so the bit math runs in BigInt; only the final (much smaller) millisecond timestamp is
 * converted back to a regular number.
 */
export function decodeSnowflake(raw: string): DecodedSnowflake | null {
  // A pasted message link (discord.com/channels/<server>/<channel>/<message>, also ptb./canary.
  // and the old discordapp.com) decodes to its last ID: the message itself.
  const link = /^https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(?:@me|\d+)\/\d+(?:\/(\d+))?\/?$/.exec(raw.trim());
  const trimmed = link ? (link[1] ?? raw.trim().split('/').filter(Boolean).pop()!) : raw.trim();
  if (!/^\d{1,20}$/.test(trimmed)) return null;
  let id: bigint;
  try {
    id = BigInt(trimmed);
  } catch {
    return null;
  }
  const timestampMs = (id >> 22n) + DISCORD_EPOCH_MS;
  if (timestampMs < 0n) return null;
  const unixMs = Number(timestampMs);
  if (!Number.isSafeInteger(unixMs)) return null;
  return {
    unixMs,
    unixSeconds: Math.floor(unixMs / 1000),
    workerId: Number((id & 0x3e0000n) >> 17n),
    processId: Number((id & 0x1f000n) >> 12n),
    increment: Number(id & 0xfffn),
  };
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function shortDate(d: Date): string {
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
}

function formatTime(d: Date, withSeconds: boolean): string {
  let hours = d.getHours();
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  const suffix = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return withSeconds ? `${hours}:${minutes}:${seconds} ${suffix}` : `${hours}:${minutes} ${suffix}`;
}

function formatRelative(unixSeconds: number, nowSeconds: number): string {
  const diff = unixSeconds - nowSeconds;
  const abs = Math.abs(diff);
  const future = diff > 0;

  const units: [number, string][] = [
    [31536000, 'year'],
    [2592000, 'month'],
    [604800, 'week'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
    [1, 'second'],
  ];

  if (abs < 1) return 'now';

  for (const [secondsPer, name] of units) {
    const value = Math.floor(abs / secondsPer);
    if (value >= 1) {
      const plural = value === 1 ? name : `${name}s`;
      return future ? `in ${value} ${plural}` : `${value} ${plural} ago`;
    }
  }
  return 'now';
}

/**
 * Renders the preview text exactly as Discord's client would, given the viewer's
 * clock is `nowSeconds` (only relevant for the 'R' relative format).
 */
export function renderDiscordPreview(
  unixSeconds: number,
  code: DiscordFormatCode,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): string {
  const d = new Date(unixSeconds * 1000);

  switch (code) {
    case 't':
      return formatTime(d, false);
    case 'T':
      return formatTime(d, true);
    case 'd':
      return shortDate(d);
    case 'D':
      return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    case 'f':
      return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} at ${formatTime(d, false)}`;
    case 'F':
      return `${DAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} at ${formatTime(d, false)}`;
    case 's':
      return `${shortDate(d)}, ${formatTime(d, false)}`;
    case 'S':
      return `${shortDate(d)}, ${formatTime(d, true)}`;
    case 'R':
      return formatRelative(unixSeconds, nowSeconds);
    default:
      return '';
  }
}

/** Builds a unix-seconds timestamp from local date/time input field values in a specific IANA timeZone. */
export function dateTimeToUnixInTz(dateValue: string, timeValue: string, timeZone?: string): number | null {
  if (!dateValue || !timeValue) return null;
  const [y, m, d] = dateValue.split('-').map(Number);
  const [h, min] = timeValue.split(':').map(Number);
  if ([y, m, d, h, min].some((n) => Number.isNaN(n))) return null;

  if (!timeZone || timeZone === 'UTC') {
    if (timeZone === 'UTC') {
      return Math.floor(Date.UTC(y, m - 1, d, h, min, 0) / 1000);
    }
    const date = new Date(y, m - 1, d, h, min, 0, 0);
    return Math.floor(date.getTime() / 1000);
  }

  try {
    const utcGuess = Date.UTC(y, m - 1, d, h, min, 0);
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    });

    /** The zone's UTC offset in ms at a given instant. */
    const offsetAt = (instant: number): number => {
      const parts = formatter.formatToParts(new Date(instant));
      let py = 0, pm = 0, pd = 0, ph = 0, pmin = 0, ps = 0;
      for (const p of parts) {
        if (p.type === 'year') py = parseInt(p.value, 10);
        else if (p.type === 'month') pm = parseInt(p.value, 10);
        else if (p.type === 'day') pd = parseInt(p.value, 10);
        else if (p.type === 'hour') {
          let val = parseInt(p.value, 10);
          if (val === 24) val = 0;
          ph = val;
        }
        else if (p.type === 'minute') pmin = parseInt(p.value, 10);
        else if (p.type === 'second') ps = parseInt(p.value, 10);
      }
      return Date.UTC(py, pm - 1, pd, ph, pmin, ps) - instant;
    };

    // The offset has to be sampled at the instant we are actually returning, not at the
    // UTC-reading of the wall clock. Those differ across a DST boundary: for a time a few
    // hours after "spring forward", the first sample still reports the pre-transition
    // offset and the result lands an hour off. Re-sample at the candidate instant and,
    // if the offset moved, use the corrected one.
    const offset1 = offsetAt(utcGuess);
    let actualUtc = utcGuess - offset1;
    const offset2 = offsetAt(actualUtc);
    if (offset2 !== offset1) actualUtc = utcGuess - offset2;
    return Math.floor(actualUtc / 1000);
  } catch {
    const date = new Date(y, m - 1, d, h, min, 0, 0);
    return Math.floor(date.getTime() / 1000);
  }
}

/** Builds a unix-seconds timestamp from local date/time input field values (legacy wrapper). */
export function localDateTimeToUnix(dateValue: string, timeValue: string): number | null {
  return dateTimeToUnixInTz(dateValue, timeValue);
}

export function nowLocalDateValue(timeZone?: string): string {
  const d = new Date();
  if (!timeZone) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(d);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    return `${y}-${m}-${day}`;
  } catch {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}

export function nowLocalTimeValue(timeZone?: string): string {
  const d = new Date();
  if (!timeZone) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(d);
    let h = parts.find((p) => p.type === 'hour')?.value ?? '00';
    if (h === '24') h = '00';
    const min = parts.find((p) => p.type === 'minute')?.value ?? '00';
    return `${h}:${min}`;
  } catch {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}

export interface TimezoneOption {
  value: string;
  label: string;
  group: string;
}

export const POPULAR_TIMEZONES: TimezoneOption[] = [
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)', group: 'UTC' },
  { value: 'America/New_York', label: 'New York (EDT/EST, UTC-4/-5)', group: 'Americas' },
  { value: 'America/Chicago', label: 'Chicago / Central (CDT/CST, UTC-5/-6)', group: 'Americas' },
  { value: 'America/Denver', label: 'Denver / Mountain (MDT/MST, UTC-6/-7)', group: 'Americas' },
  { value: 'America/Los_Angeles', label: 'Los Angeles / Pacific (PDT/PST, UTC-7/-8)', group: 'Americas' },
  { value: 'America/Anchorage', label: 'Anchorage (AKDT/AKST, UTC-8/-9)', group: 'Americas' },
  { value: 'Pacific/Honolulu', label: 'Honolulu (HST, UTC-10)', group: 'Americas' },
  { value: 'America/Sao_Paulo', label: 'São Paulo (BRT, UTC-3)', group: 'Americas' },
  { value: 'America/Toronto', label: 'Toronto (EDT/EST, UTC-4/-5)', group: 'Americas' },
  { value: 'Europe/London', label: 'London (BST/GMT, UTC+1/+0)', group: 'Europe' },
  { value: 'Europe/Paris', label: 'Paris / Berlin / Madrid / Rome (CEST/CET, UTC+2/+1)', group: 'Europe' },
  { value: 'Europe/Athens', label: 'Athens / Helsinki / Bucharest (EEST/EET, UTC+3/+2)', group: 'Europe' },
  { value: 'Europe/Moscow', label: 'Moscow (MSK, UTC+3)', group: 'Europe' },
  { value: 'Asia/Dubai', label: 'Dubai (GST, UTC+4)', group: 'Asia & Middle East' },
  { value: 'Asia/Kolkata', label: 'India / Kolkata (IST, UTC+5:30)', group: 'Asia & Middle East' },
  { value: 'Asia/Bangkok', label: 'Bangkok / Jakarta (ICT, UTC+7)', group: 'Asia & Middle East' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT, UTC+8)', group: 'Asia & Middle East' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong (HKT, UTC+8)', group: 'Asia & Middle East' },
  { value: 'Asia/Tokyo', label: 'Tokyo / Seoul (JST/KST, UTC+9)', group: 'Asia & Middle East' },
  { value: 'Australia/Perth', label: 'Perth (AWST, UTC+8)', group: 'Australia & Pacific' },
  { value: 'Australia/Sydney', label: 'Sydney / Melbourne (AEST/AEDT, UTC+10/+11)', group: 'Australia & Pacific' },
  { value: 'Pacific/Auckland', label: 'Auckland / New Zealand (NZST/NZDT, UTC+12/+13)', group: 'Australia & Pacific' },
];

