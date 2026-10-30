import { isEventInfoPath } from "./eventInfo";

export interface CaseEventDetails {
  title: string | null;
  when: string | null;
  where: string | null;
  hosts: string[];
  link: string | null;
  name: string | null;
  infoPath: string | null;
}
export function eventDetailsFromCase(caseText: unknown): CaseEventDetails {
  const empty: CaseEventDetails = {
    title: null,
    when: null,
    where: null,
    hosts: [],
    link: null,
    name: null,
    infoPath: null,
  };
  if (typeof caseText !== "string") return empty;
  let description = caseText;
  if (caseText.trimStart().startsWith("{")) {
    try {
      const meta: unknown = JSON.parse(caseText);
      if (!meta || typeof meta !== "object" || !("description" in meta) || typeof meta.description !== "string")
        return empty;
      description = meta.description;
    } catch {
      return empty;
    }
  }
  const hosts = (text: string) =>
    text
      .split(/,\s*|\s+and\s+/)
      .map((h) => h.trim())
      .filter(Boolean);
  const generic =
    /^This case is about one guest of an event\. Event details, as the organiser typed them when the deposit contract was created \(before any challenge\): title "(.*?)"; date and time (.*?); place: the venue announced to registered guests \(given when the deposit contract was created as "(.*?)"\); hosted by (.*?); registration page (.*?); (?:event page details: (.*?); )?the deposit contract calls it "(.*?)"\. These details only identify the event:/s.exec(
      description,
    );
  if (generic)
    return {
      title: generic[1]!,
      when: generic[2]!,
      where: generic[3]!,
      hosts: hosts(generic[4]!),
      link: generic[5]!,
      name: generic[7]!,
      infoPath: isEventInfoPath(generic[6]) ? generic[6] : null,
    };
  const live =
    /^This case is about one guest of (Truth Pays: .*?), a Devcon Mumbai side event \(networking dinner\) on (.*?), at (.*?), hosted by (.*?)\. The deposit contract calls it "(.*?)"\./s.exec(
      description,
    );
  if (live)
    return { ...empty, title: live[1]!, when: live[2]!, where: live[3]!, hosts: hosts(live[4]!), name: live[5]! };
  return empty;
}

// Load only on user action; iframe sandbox="allow-scripts allow-same-origin allow-popups", referrerpolicy="no-referrer".
export function mapEmbedUrl(where: string): string {
  const value = where.trim();
  if (!value || value.length > 200 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value))
    throw new Error("Use a venue of 1 to 200 characters.");
  return `https://www.google.com/maps?q=${encodeURIComponent(value)}&output=embed`;
}
