import type { PrivateStage } from "./entries.ts";
import type { FormErrorCode } from "./external-form.ts";

function wall(value: string, zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23" }).formatToParts(new Date(value));
  const get = (type:string) => parts.find((part)=>part.type===type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}
export function dateControls(value: string | null, zone: string | null) {
  if (!value) return { date:"", time:"" };
  const local = value.includes("T") && zone ? wall(value,zone) : value;
  const time=value.includes("T")?/T(\d{2}:\d{2})(?::(\d{2}))?/.exec(local):null;
  return { date:local.slice(0,10),time:time?time[1]+":"+(time[2]??"00"):"" };
}
export class DateControlError extends Error {
  code: FormErrorCode;
  field?: string;
  constructor(message: string, code: FormErrorCode = "date", field?: string) {
    super(message); this.code = code; this.field = field;
  }
}
export function fromDateControls(day:string,time:string,zone:string,occurrence:string,previous:string|null=null) {
  if (!day) { if(time)throw new DateControlError("A time needs a date", "dateRequired");return null; }
  if(!/^\d{4}-\d\d-\d\d$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day)throw new DateControlError("Invalid date");
  if(!time)return day;
  if(!/^\d\d:\d\d(?::\d\d)?$/.test(time))throw new DateControlError("Invalid time", "time");
  const local = day+"T"+time+(time.length===5?":00":"");
  const prior=dateControls(previous,zone||null);
  if(previous?.includes("T")&&!occurrence&&prior.date===day&&prior.time===(time.length===5?time+":00":time))return previous;
  if(!zone)throw new DateControlError("Choose the source time zone for an exact time", "zoneRequired");
  const guess=Date.parse(local+"Z"),matches:number[]=[];
  if(!Number.isFinite(guess))throw new DateControlError("Invalid time", "time");
  // Collect offsets around the local day, including both sides of seasonal clock changes.
  for(let delta=-36;delta<=36;delta+=6){
    const probe=guess+delta*3600_000;
    const offset=Date.parse(wall(new Date(probe).toISOString(),zone)+"Z")-probe;
    const candidate=guess-offset;
    if(wall(new Date(candidate).toISOString(),zone)===local&&!matches.includes(candidate))matches.push(candidate);
  }
  matches.sort((a,b)=>a-b);
  if(!matches.length)throw new DateControlError("This local time does not exist", "nonexistent");
  if(matches.length>1&&!['first','second'].includes(occurrence))throw new DateControlError("Choose an occurrence for the repeated local time", "occurrence");
  return new Date(matches[occurrence==='second'?matches.length-1:0]!).toISOString();
}

export const stageFormNames=["name","eventStart","eventEnd","timeZone","format","entry","requiresStage","fixedAttendance",
  "startDate","startTime","endDate","endTime","startOccurrence","endOccurrence"];
export function parseStageForm(data:URLSearchParams,previous?:PrivateStage){
  if(data.has("fixedAttendance")&&data.get("fixedAttendance")!=="1")throw new DateControlError("Invalid attendance", "choice", "fixedAttendance");
  const widgets=data.has("startDate")||data.has("endDate");
  if(widgets&&(data.has("eventStart")||data.has("eventEnd")))throw new DateControlError("Mixed date formats");
  const zone=data.get("timeZone")?.trim()||"";
  if(zone)try{new Intl.DateTimeFormat('en',{timeZone:zone});}catch{throw new DateControlError("Invalid source time zone", "zone", "timeZone");}
  const convert = (side: "start" | "end", prior: string | null | undefined) => {
    try { return fromDateControls(data.get(side+"Date")??"",data.get(side+"Time")??"",zone,data.get(side+"Occurrence")??"",prior); }
    catch (error) {
      if (error instanceof DateControlError) error.field = error.code === "zoneRequired" ? "timeZone"
        : side + (["date", "dateRequired"].includes(error.code) ? "Date" : error.code === "occurrence" ? "Occurrence" : "Time");
      throw error;
    }
  };
  return {name:data.get("name"),eventStart:widgets?convert("start",previous?.eventStart):data.get("eventStart")||null,
    eventEnd:widgets?convert("end",previous?.eventEnd):data.get("eventEnd")||null,
    timeZone:zone||null,format:data.get("format"),entry:data.get("entry"),requiresStage:data.get("requiresStage")||null,fixedAttendance:data.get("fixedAttendance")==="1"};
}
