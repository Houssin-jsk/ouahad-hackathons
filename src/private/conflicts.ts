import { dateAt } from "../model.ts";
import type { PrivateEntry, TrackedStage } from "./entries.ts";

export type Conflict = {
  kind: "confirmed" | "possible";
  a: { entryId: string; title: string; stage: string; stageKey: string; conditional: boolean; accepted: boolean };
  b: { entryId: string; title: string; stage: string; stageKey: string; conditional: boolean; accepted: boolean };
};
type Interval = { minStart: number; maxStart: number; minEnd: number; maxEnd: number; exact: boolean };
const hour = 3600_000;
// Find a calendar-day boundary in an IANA zone. This respects Morocco's seasonal offset.
function dayStart(day: string, zone: string): number {
  let low = Date.parse(day) - 25 * hour, high = Date.parse(day) + 25 * hour;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (dateAt(new Date(mid), zone) < day) low = mid; else high = mid;
  }
  return high;
}
function nextDay(day: string) { return new Date(Date.parse(day) + 24 * hour).toISOString().slice(0, 10); }
function boundary(value: string, zone: string | null) {
  if (value.includes("T")) return { min: Date.parse(value), max: Date.parse(value), exact: true };
  return {
    min: zone ? dayStart(value, zone) : Date.parse(value) - 14 * hour,
    max: zone ? dayStart(nextDay(value), zone) : Date.parse(nextDay(value)) + 12 * hour,
    exact: false,
  };
}
function interval(stage: TrackedStage): Interval | null {
  if (!stage.eventStart || !stage.eventEnd) return null;
  const start = boundary(stage.eventStart, stage.timeZone), end = boundary(stage.eventEnd, stage.timeZone);
  return {
    minStart: start.min, maxStart: start.max, minEnd: end.min, maxEnd: end.max,
    exact: start.exact && end.exact && stage.fixedAttendance,
  };
}
export function eligibleStages(entry: PrivateEntry) {
  const entryActive = entry.stages.some((stage) =>
    stage.application === "submitted" || stage.decision === "accepted");
  if (!entryActive) return [];
  const result: { stage: TrackedStage; conditional: boolean }[] = [];
  for (const stage of entry.stages) {
    if (stage.unavailable || stage.intent === "declined" || stage.decision === "rejected") continue;
    if (stage.entry === "direct") {
      if (stage.application === "submitted" || stage.decision === "accepted") result.push({ stage, conditional: false });
    } else {
      if (stage.application === "submitted" || stage.decision === "accepted") {
        result.push({ stage, conditional: false });
        continue;
      }
      const prior = result.find(({ stage: item }) => item.key === stage.requiresStage);
      if (!prior) continue;
      result.push({ stage, conditional: true });
    }
  }
  return result;
}

export function conflicts(entries: PrivateEntry[]): Conflict[] {
  const result: Conflict[] = [];
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const a = entries[i]!, b = entries[j]!;
    for (const first of eligibleStages(a)) for (const second of eligibleStages(b)) {
      const x = interval(first.stage), y = interval(second.stage);
      if (!x || !y || !(x.minStart < y.maxEnd && y.minStart < x.maxEnd)) continue;
      result.push({
        kind: x.exact && y.exact ? "confirmed" : "possible",
        a: { entryId: a.id, title: a.title, stage: first.stage.name, stageKey: first.stage.key,
          conditional: first.conditional, accepted: first.stage.decision === "accepted" },
        b: { entryId: b.id, title: b.title, stage: second.stage.name, stageKey: second.stage.key,
          conditional: second.conditional, accepted: second.stage.decision === "accepted" },
      });
    }
  }
  return result;
}

export function privateProgress(entries: PrivateEntry[]) {
  const entered = (entry: PrivateEntry) => entry.stages.some((stage) =>
    stage.application === "submitted" || stage.decision === "accepted");
  return {
    entries: entries.filter(entered).length,
    accepted: entries.filter((entry) => entry.stages.some((stage) => stage.decision === "accepted")).length,
    attended: entries.filter((entry) => entry.stages.some((stage) => stage.attended)).length,
    stageAttendances: entries.flatMap((entry) => entry.stages).filter((stage) => stage.attended).length,
    advancements: entries.flatMap((entry) => entry.stages).filter((stage) => stage.result === "advanced").length,
    domains: [...new Set(entries.map((entry) => entry.domain))].map((domain) => ({
      domain, entries: entries.filter((entry) => entry.domain === domain && entered(entry)).length,
      stageAttendances: entries.filter((entry) => entry.domain === domain)
        .flatMap((entry) => entry.stages).filter((stage) => stage.attended).length,
      advancements: entries.filter((entry) => entry.domain === domain)
        .flatMap((entry) => entry.stages).filter((stage) => stage.result === "advanced").length,
    })),
  };
}
