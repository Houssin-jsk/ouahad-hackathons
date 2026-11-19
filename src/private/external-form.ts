import { ZodError } from "zod";
import { externalInput } from "./entries.ts";
import { DateControlError, parseStageForm } from "./stage-form.ts";

export type FormErrorCode = "required" | "tooLong" | "url" | "date" | "time" | "dateRequired"
  | "zoneRequired" | "zone" | "nonexistent" | "occurrence" | "endAfterStart" | "choice";
export type FormErrors = Partial<Record<string, FormErrorCode>>;

// Only classify known field names and error codes. Never log inputs or echo Zod messages/values.
export function createFormErrors(error: ZodError | DateControlError): FormErrors {
  if (error instanceof DateControlError) return { [error.field ?? "startDate"]: error.code };
  const errors: FormErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.filter((part) => part !== "stage");
    const raw = String(path[0] ?? "name");
    const field = raw === "eventStart" ? "startDate" : raw === "eventEnd" ? "endDate" : raw;
    errors[field] = raw === "eventUrl" ? "url" : issue.code === "too_big" ? "tooLong"
      : issue.code === "custom" && raw === "eventEnd" ? "endAfterStart"
        : ["title", "domain", "name"].includes(raw) ? "required"
          : raw === "timeZone" ? "zone" : ["eventStart", "eventEnd"].includes(raw) ? "date" : "choice";
  }
  return errors;
}

export function parseExternalForm(data: URLSearchParams) {
  return externalInput.parse({
    title: data.get("title"), domain: data.get("domain"), eventUrl: data.get("eventUrl")?.trim() || null,
    stage: parseStageForm(data),
  });
}
