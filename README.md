# discord-timestamp-kit

Make Discord timestamp codes like `<t:1798765200:F>`, which every reader sees in their own time zone. The kit also converts a date and time in any IANA time zone to Unix seconds without DST bugs, accepts Unix input in seconds or milliseconds, and decodes Discord snowflake IDs into the moment they were created. It is pure TypeScript with zero dependencies and no DOM, so it runs in browsers, Workers, Deno, Bun and Node 22+.

Powers https://discordtimestampgen.com. If you'd rather not bundle a library, the same engine is also a free JSON API: https://discordtimestampgen.com/developers

## Use

```
npm install discord-timestamp-kit
```

### Make a `<t:unix:F>` code

```ts
import { buildTimestampCode, DISCORD_FORMATS } from 'discord-timestamp-kit';

buildTimestampCode(1798765200, 'F');   // '<t:1798765200:F>'

for (const f of DISCORD_FORMATS) {
  console.log(f.code, f.label, buildTimestampCode(1798765200, f.code));
}
// t Short Time       <t:1798765200:t>
// T Long Time        <t:1798765200:T>
// d Short Date       <t:1798765200:d>
// D Long Date        <t:1798765200:D>
// f Short Date/Time  <t:1798765200:f>
// F Long Date/Time   <t:1798765200:F>
// R Relative Time    <t:1798765200:R>
```

### Convert a local date and time in a time zone to Unix

```ts
import { dateTimeToUnixInTz, buildTimestampCode } from 'discord-timestamp-kit';

// 8 PM on New Year's Eve in New York
const unix = dateTimeToUnixInTz('2026-12-31', '20:00', 'America/New_York'); // 1798765200
buildTimestampCode(unix!, 'R');   // '<t:1798765200:R>'
```

The inputs use the same `YYYY-MM-DD` and `HH:mm` strings that `<input type="date">` and `<input type="time">` produce. The time-zone offset is sampled twice, the second time at the instant being returned, so times in the hours around a DST change don't come out an hour off. Pass `'UTC'` for UTC. Leave the zone out to use the runtime's own zone. The function returns `null` for blank or malformed input. An unknown zone name falls back to the runtime's zone.

### Parse a pasted Unix timestamp (seconds or milliseconds)

```ts
import { parseUnixInput } from 'discord-timestamp-kit';

parseUnixInput('1798765200');      // { unix: 1798765200, wasMs: false }
parseUnixInput('1798765200000');   // { unix: 1798765200, wasMs: true }
parseUnixInput('12.5');            // null (integers only)
```

Any value of 100,000,000,000 or more is treated as milliseconds. In seconds, that would be a date in the year 5138.

### Decode a Discord snowflake

```ts
import { decodeSnowflake } from 'discord-timestamp-kit';

const s = decodeSnowflake('175928847299117063');
// { unixMs: 1462015105796, unixSeconds: 1462015105, workerId: 1, processId: 0, increment: 7 }
new Date(s!.unixMs).toISOString();   // '2016-04-30T11:18:25.796Z'
```

Message, user, channel and server IDs are all snowflakes. The bit math uses BigInt, so IDs above `Number.MAX_SAFE_INTEGER` decode exactly. Pass the ID as a string.

### Preview what Discord will show

```ts
import { renderDiscordPreview } from 'discord-timestamp-kit';

renderDiscordPreview(1798765200, 'F');                 // e.g. 'Thursday, December 31, 2026 8:00 PM'
renderDiscordPreview(1798765200, 'R', 1798758000);     // 'in 2 hours'
```

The preview uses Discord's en-US layout, in the runtime's local time zone. The `R` format takes an optional "now", in Unix seconds.

## API

| Export | What it does |
|---|---|
| `DISCORD_FORMATS` | The 7 format codes (`t T d D f F R`) with label, description and example |
| `buildTimestampCode(unix, code)` | Returns `<t:unix:code>` |
| `dateTimeToUnixInTz(date, time, timeZone?)` | Converts a wall-clock date and time in an IANA zone to Unix seconds, DST-safe |
| `parseUnixInput(raw)` | Parses an integer string in seconds or milliseconds, or returns `null` |
| `decodeSnowflake(raw)` | Returns `{ unixMs, unixSeconds, workerId, processId, increment }`, or `null` |
| `renderDiscordPreview(unix, code, now?)` | Returns the text Discord's English client would show |

Types: `DiscordFormat`, `DiscordFormatCode`, `DecodedSnowflake`.

## Tests

```
npm test   # 23 engine checks: DST boundaries in New York, London and Sydney, half-hour offsets, ms detection, Discord's documented snowflake example
```

## License

MIT
