import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { setSectionCodes } from "../../public/scripts/sectionCodes.js";

// starmap.js preloads planet images when it is imported; node has no Image.
globalThis.Image ??= class { set src(_v) {} };
const { beltNoticeHtml } = await import("../../public/scripts/starmap.js");

// ISP-254 Bd (AB#4819): Operations' statuses and messages (mining leases, extractor yards and their cycles, probes and
// the expeditions they fly) carry the protocol line after their plain words (public/scripts/protocol.js). The plain words
// are unchanged. docs/ab-4819/strings.md lists every string.
const read = (file) => readFileSync(new URL(`../../public/scripts/${file}`, import.meta.url), "utf8");
const LINE = (phrase, code) => `<span class="protocol-line">${phrase}<span class="protocol-line__code" aria-hidden="true"> // ${code}</span></span>`;

afterEach(() => setSectionCodes(null));

describe("a refused scout or launch says Denied beside the button (AB#4819)", () => {
  it("draws the protocol line after the plain refusal, with the Starmap's code", () => {
    setSectionCodes({ screens: [{ id: "starmap", code: "ISA-NAV-1" }] });
    const html = beltNoticeHtml("This belt was mined out.", { meaning: "refused", screen: "starmap" });
    expect(html).toContain(`This belt was mined out. ${LINE("Denied", "ISA-NAV-1")}</p>`);
    expect(beltNoticeHtml("Launching this expedition requires 5,000 credits. Current reserves: 10 credits.", { meaning: "unfunded", screen: "starmap" })).toContain("Unfunded, balance insufficient");
  });

  it("keeps the plain notice alone when it carries no protocol, and draws nothing for no message", () => {
    expect(beltNoticeHtml("No belt here.")).not.toContain("protocol-line");
    expect(beltNoticeHtml("", { meaning: "refused", screen: "starmap" })).toBe("");
  });
});

describe("every Operations message passes its protocol (a source check, AB#4819)", () => {
  const station = read("views/station.js");
  const starmapView = read("views/starmap.js");
  const cases = [
    [station, /mining lease approved by the ISA\.`, "success", \{ meaning: "active", screen: "building-isa-claims-leases" \}/],
    [station, /"Lease application failed\.", "warn", \{ meaning: refusalMeaning\(err\), screen: "building-isa-claims-leases" \}/],
    [station, /"Basic Extractor Yard commissioned and linked to lease\.", "success", \{ meaning: "complete", screen: "building-lease" \}/],
    [station, /"Mining cycle started\.", "success", \{ meaning: "active", screen: "building-lease" \}/],
    [station, /"Mining cycle stopped\.", "success", \{ meaning: "cancelled", screen: "building-lease" \}/],
    [station, /setStatusLine\(statusEl, err\.message \|\| "Mining cycle failed to start\.", \{ meaning: refusalMeaning\(err\), screen: "building-lease" \}\)/],
    [station, /setStatusLine\(statusEl, err\.message \|\| "Could not stop the mining cycle\.", \{ meaning: refusalMeaning\(err\), screen: "building-lease" \}\)/],
    [station, /"Probe fabrication failed\.", "warn", \{ meaning: refusalMeaning\(err\), screen: "building-assembly-facility" \}/],
    [station, /fabricationQueue\), "ok", \{ meaning: "queued", screen: "building-assembly-facility" \}/],
    [starmapView, /"Mining expedition launched!", "ok", \{ meaning: "active", screen: "starmap" \}/],
    [starmapView, /message: err\.message \|\| "Belt scouting failed\.", protocol: denied/]
  ];
  it.each(cases.map(([src, re]) => [re.source.slice(0, 60), src, re]))("%s", (_label, src, re) => {
    expect(src).toMatch(re);
  });

  it("a yard's Active badge is In force and Downtime is Suspended; Idle and Upgrading have none", () => {
    // the badge and its line share .extractor__status, so the line sits beside the badge it names
    expect(station).toContain('<span class="extractor__status"><span class="ui-badge station__status--${statusClass}" data-role="yard-status">');
    expect(station).toContain('${ex.downtimeActive || ex.active ? ` ${protocolLineHtml({ meaning: ex.downtimeActive ? "suspended" : "active", screen: "building-lease" })}` : ""}</span>');
  });

  it("the Mining cycles page's Active status is In force", () => {
    expect(read("views/miningTicker.js")).toContain('Status: ${active ? `Active ${protocolLineHtml({ meaning: "active", screen: "station-active-mining-cycles" })}` : "Idle"}');
  });
});
