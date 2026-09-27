import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { deadline, fictionYear, realUtcTime, timeHtml, utcClock, utcDate, utcTime } from "../../public/scripts/timeFormat.js";

// ISP-249 (AB#945; docs/design/BUREAUCRATIC_UI.md, "Timestamps"): one format for every time the game shows, and no
// other formatter anywhere.
const T = Date.UTC(2026, 8, 27, 9, 42, 30); // 2026-09-27 09:42:30 UTC

describe("the one time format (AB#945)", () => {
  it("writes YYYY-MM-DD HH:MM UTC in the in-fiction year, the real one + 121, and only the year moves", () => {
    expect(fictionYear(2026)).toBe(2147);
    expect(utcDate(T)).toBe("2147-09-27");
    expect(utcClock(T)).toBe("09:42 UTC");
    expect(utcTime(T, { now: Date.UTC(2026, 9, 1) })).toBe("2147-09-27 09:42 UTC");
    expect(utcTime(Date.UTC(2028, 1, 29, 23, 5), { now: 0 })).toBe("2149-02-29 23:05 UTC"); // the real day, relabelled
  });

  it("leaves the date out when it is today's, unless the text will be read later", () => {
    expect(utcTime(T, { now: T + 3_600_000 })).toBe("09:42 UTC");
    expect(utcTime(T, { now: T + 3_600_000, withDate: true })).toBe("2147-09-27 09:42 UTC");
    expect(utcTime(Date.UTC(2026, 8, 27, 23, 59), { now: Date.UTC(2026, 8, 28, 0, 1) })).toBe("2147-09-27 23:59 UTC"); // yesterday, in UTC
  });

  it("says how far away a deadline within a day is", () => {
    expect(deadline(T + (60 + 55) * 60_000, T)).toBe("in 1 h 55 min (2147-09-27 11:37 UTC)");
    expect(deadline(T + 30 * 60_000, T)).toBe("in 30 min (2147-09-27 10:12 UTC)");
    expect(deadline(T + 2 * 86_400_000, T)).toBe("2147-09-29 09:42 UTC");
  });

  it("gives machines the real instant, and keeps the real year outside the fiction", () => {
    expect(timeHtml(T, { now: 0 })).toBe('<time datetime="2026-09-27T09:42:30.000Z">2147-09-27 09:42 UTC</time>');
    expect(realUtcTime(T)).toBe("2026-09-27 09:42 UTC");
    expect(utcTime(null)).toBe("—");
    expect(utcTime("not a time")).toBe("—");
  });
});

describe("no other date formatter (AB#945)", () => {
  const root = path.resolve("public/scripts").replace(/public[\\/]scripts$/, "");
  const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? (["node_modules", "vendor"].includes(d.name) ? [] : files(path.join(dir, d.name))) : d.name.endsWith(".js") ? [path.join(dir, d.name)] : []));
  const rel = (f) => path.relative(root, f).replace(/\\/g, "/");
  // outside the fiction and not for a person to read: an email's RFC 2822 Date header
  const ALLOWED = { "server/mailSmtpTransport.js": /Date: \$\{now\.toUTCString\(\)\}/ };

  it("finds no locale date formatter, and no hand-made UTC string, outside public/scripts/timeFormat.js", () => {
    const offences = [];
    for (const f of [...files(path.join(root, "public/scripts")), ...files(path.join(root, "server"))]) {
      const name = rel(f);
      if (name === "public/scripts/timeFormat.js") continue;
      const src = fs.readFileSync(f, "utf8");
      const lines = src.split(/\r?\n/);
      // a variable holding a date: `const d = new Date(...)`
      const dateVars = [...src.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*new Date\(/g)].map((m) => m[1]);
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return; // comments
        const bad = /toLocaleDateString|toLocaleTimeString|Intl\.DateTimeFormat|dateStyle|timeStyle|toUTCString\(|toISOString\(\)\.slice\((0, 16|11, 16)\)|new Date\([^)]*\)\.toLocaleString\(/.test(line)
          || dateVars.some((v) => new RegExp(`\\b${v}\\.toLocaleString\\(`).test(line));
        if (bad && !(ALLOWED[name] && ALLOWED[name].test(line))) offences.push(`${name}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(offences).toEqual([]);
  });
});
