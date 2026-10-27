// Unit check for the timestamp engine. The conversion is the whole product, so the cases
// that matter are the ones a hand-rolled offset calculation gets wrong: DST boundaries.
// Run with: npx tsx test/run.ts
import assert from 'node:assert/strict';
import { dateTimeToUnixInTz, renderDiscordPreview, buildTimestampCode, parseUnixInput, decodeSnowflake } from '../src/index.ts';

const failures: string[] = [];
function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok   ${label}`);
  } catch (err) {
    failures.push(`${label}: ${(err as Error).message}`);
    console.log(`  FAIL ${label}`);
  }
}

// Reference instants, verified against the IANA database.
//
// The cases that matter are the ones where the wall-clock time read as UTC lands on the
// opposite side of a DST transition from the answer. A single-pass offset lookup samples
// the offset at the wrong instant there and is an hour out. For America/New_York in 2026
// that is 02:00-06:59 wall clock on the transition days, so those are the cases below;
// midday on the same day does NOT exercise the bug.
check('EST before spring-forward (UTC-5)', () => {
  assert.equal(dateTimeToUnixInTz('2026-03-08', '00:30', 'America/New_York'), Date.UTC(2026, 2, 8, 5, 30) / 1000);
});
check('EDT in the hour right after spring-forward (UTC-4)', () => {
  // 02:00 EST jumps to 03:00 EDT, so 03:00 local is 07:00 UTC, not 08:00.
  assert.equal(dateTimeToUnixInTz('2026-03-08', '03:00', 'America/New_York'), Date.UTC(2026, 2, 8, 7, 0) / 1000);
});
check('EDT a few hours after spring-forward (UTC-4)', () => {
  assert.equal(dateTimeToUnixInTz('2026-03-08', '06:00', 'America/New_York'), Date.UTC(2026, 2, 8, 10, 0) / 1000);
});
check('EDT after spring-forward, same day (UTC-4)', () => {
  assert.equal(dateTimeToUnixInTz('2026-03-08', '14:00', 'America/New_York'), Date.UTC(2026, 2, 8, 18, 0) / 1000);
});
check('EDT well after the transition (UTC-4)', () => {
  assert.equal(dateTimeToUnixInTz('2026-06-15', '09:00', 'America/New_York'), Date.UTC(2026, 5, 15, 13, 0) / 1000);
});
// 2026-11-01 02:00 EDT falls back to 01:00 EST (06:00 UTC).
check('EDT before fall-back (UTC-4)', () => {
  assert.equal(dateTimeToUnixInTz('2026-11-01', '00:30', 'America/New_York'), Date.UTC(2026, 10, 1, 4, 30) / 1000);
});
check('EST in the hours right after fall-back (UTC-5)', () => {
  assert.equal(dateTimeToUnixInTz('2026-11-01', '03:00', 'America/New_York'), Date.UTC(2026, 10, 1, 8, 0) / 1000);
});
check('EST after fall-back, same day (UTC-5)', () => {
  assert.equal(dateTimeToUnixInTz('2026-11-01', '14:00', 'America/New_York'), Date.UTC(2026, 10, 1, 19, 0) / 1000);
});
// Europe/London springs forward 2026-03-29 01:00 GMT -> 02:00 BST.
check('BST in the hour right after London spring-forward', () => {
  assert.equal(dateTimeToUnixInTz('2026-03-29', '02:00', 'Europe/London'), Date.UTC(2026, 2, 29, 1, 0) / 1000);
});
check('Europe/London BST', () => {
  assert.equal(dateTimeToUnixInTz('2026-07-01', '12:00', 'Europe/London'), Date.UTC(2026, 6, 1, 11, 0) / 1000);
});
check('Asia/Kolkata half-hour offset', () => {
  assert.equal(dateTimeToUnixInTz('2026-07-01', '12:00', 'Asia/Kolkata'), Date.UTC(2026, 6, 1, 6, 30) / 1000);
});
check('Australia/Sydney southern-hemisphere DST', () => {
  assert.equal(dateTimeToUnixInTz('2026-01-15', '12:00', 'Australia/Sydney'), Date.UTC(2026, 0, 15, 1, 0) / 1000);
});
check('UTC passthrough', () => {
  assert.equal(dateTimeToUnixInTz('2026-07-01', '12:00', 'UTC'), Date.UTC(2026, 6, 1, 12, 0) / 1000);
});
check('blank input returns null', () => {
  assert.equal(dateTimeToUnixInTz('', '12:00', 'UTC'), null);
  assert.equal(dateTimeToUnixInTz('2026-07-01', '', 'UTC'), null);
});
check('code syntax', () => {
  assert.equal(buildTimestampCode(1735689600, 'F'), '<t:1735689600:F>');
});
check('relative format', () => {
  const now = 1_700_000_000;
  assert.equal(renderDiscordPreview(now + 7200, 'R', now), 'in 2 hours');
  assert.equal(renderDiscordPreview(now - 60, 'R', now), '1 minute ago');
  assert.equal(renderDiscordPreview(now, 'R', now), 'now');
});
check('parseUnixInput: seconds pass through unchanged', () => {
  assert.deepEqual(parseUnixInput('1735689600'), { unix: 1735689600, wasMs: false });
});
check('parseUnixInput: milliseconds are detected and divided down', () => {
  assert.deepEqual(parseUnixInput('1735689600000'), { unix: 1735689600, wasMs: true });
});
check('parseUnixInput: negative (pre-1970) seconds are valid', () => {
  assert.deepEqual(parseUnixInput('-3600'), { unix: -3600, wasMs: false });
});
check('parseUnixInput: rejects non-integer input', () => {
  assert.equal(parseUnixInput('not-a-number'), null);
  assert.equal(parseUnixInput('1735689600.5'), null);
  assert.equal(parseUnixInput(''), null);
  assert.equal(parseUnixInput('   '), null);
});
// Discord's own documented example: 175928847299117063 -> 2016-04-30T11:18:25.796Z,
// internal worker 1, internal process 0. https://discord.com/developers/docs/reference#snowflakes
check('decodeSnowflake: matches Discord\'s documented example', () => {
  const d = decodeSnowflake('175928847299117063')!;
  assert.equal(d.unixMs, 1462015105796);
  assert.equal(new Date(d.unixMs).toISOString(), '2016-04-30T11:18:25.796Z');
  assert.equal(d.unixSeconds, 1462015105);
  assert.equal(d.workerId, 1);
  assert.equal(d.processId, 0);
});
check('decodeSnowflake: rejects non-numeric or empty input', () => {
  assert.equal(decodeSnowflake('not-a-snowflake'), null);
  assert.equal(decodeSnowflake(''), null);
  assert.equal(decodeSnowflake('-1'), null);
});
check('decodeSnowflake: rejects absurdly long input rather than hanging on a huge BigInt', () => {
  assert.equal(decodeSnowflake('1'.repeat(50)), null);
});

if (failures.length) {
  console.error(`\ndiscord-timestamp-kit: ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\ndiscord-timestamp-kit: all checks passed');
