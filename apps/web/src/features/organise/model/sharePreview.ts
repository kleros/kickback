import { describeWhen, fillShare } from "@kickback/core";

function previewDate(values: Record<string, string>) {
  if (values.start && values.end && values.timezoneOffset) {
    try {
      return describeWhen(
        `${values.start}:00${values.timezoneOffset}`,
        `${values.end}:00${values.timezoneOffset}`,
        values.zoneName,
      );
    } catch {
      // Incomplete date fields remain visible while the organiser types.
    }
  }
  return [values.start?.replace("T", " "), values.zoneName || values.timezoneOffset].filter(Boolean).join(" ");
}

export function createSharePreview(values: Record<string, string>, guestLink = "") {
  return fillShare(values.share, {
    event: values.title || values.shortName || "Your event",
    date: previewDate(values),
    venue: values.venue || "",
    luma: values.registrationLink || "",
    guestLink,
  });
}
