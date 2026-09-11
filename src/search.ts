/**
 * Client-side meeting search helpers.
 *
 * Fathom's `calendar_invitees_domains` API filter matches the meeting's
 * *associated company*, not invitee email domains — and that association is
 * often missing. All invitee/domain matching must happen client-side.
 */

export interface SearchMeeting {
  title?: string | null;
  meeting_title?: string | null;
  default_summary?: { markdown_formatted?: string | null } | null;
  action_items?: Array<{ description?: string | null }> | null;
  calendar_invitees?: Array<{
    name?: string | null;
    email?: string | null;
    email_domain?: string | null;
  }> | null;
  recorded_by?: { team?: string | null; name?: string | null; email?: string | null } | null;
  transcript?: Array<{ text?: string | null }> | null;
}

export interface ParsedSearchQuery {
  emails: string[];
  /** Invitee/title domains to match client-side (e.g. arkema.com) */
  domains: string[];
  /** Accent-folded keyword tokens that must all match (AND) */
  keywords: string[];
  /** Original free-text leftover after stripping emails/domains */
  freeText: string;
}

const EMAIL_REGEX = /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi;
const DOMAIN_REGEX = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi;

export function foldAccents(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function extractDomain(email: string): string | null {
  const match = email.match(/@([\w.-]+\.[a-z]{2,})/i);
  return match ? match[1].toLowerCase() : null;
}

function looksLikeDomain(value: string): boolean {
  const v = value.trim().toLowerCase();
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(v) && !v.includes("@") && !v.includes(" ");
}

function tokenizeKeywords(text: string): string[] {
  const folded = foldAccents(text);
  // Keep domain-like tokens intact; otherwise split on non-alphanumeric
  const raw = folded.match(/[a-z0-9]+(?:\.[a-z0-9]+)+|[a-z0-9]+/g) || [];
  return [...new Set(raw.filter((t) => t.length >= 2))];
}

/**
 * Parse a user search into emails, domains, and keyword tokens.
 * Domains/emails are NEVER intended for Fathom's company-domain API filter.
 */
export function parseSearchQuery(
  searchTerm: string | undefined | null,
  explicitEmails: string[] = [],
  explicitDomains: string[] = [],
  agentToken?: string | null
): ParsedSearchQuery {
  let remaining = (searchTerm || "").trim();
  const emails = new Set<string>();
  const domains = new Set<string>();

  for (const email of explicitEmails) {
    if (email?.includes("@")) emails.add(email.toLowerCase());
  }
  for (const domain of explicitDomains) {
    if (domain) domains.add(domain.toLowerCase().replace(/^@/, ""));
  }

  if (agentToken) {
    const agent = agentToken.trim().toLowerCase();
    if (agent.includes("@")) {
      emails.add(agent);
      const d = extractDomain(agent);
      if (d) domains.add(d);
    } else if (looksLikeDomain(agent)) {
      domains.add(agent);
    } else {
      remaining = `${remaining} ${agent}`.trim();
    }
    remaining = remaining.replace(new RegExp(agentToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  }

  const foundEmails = remaining.match(EMAIL_REGEX) || [];
  for (const email of foundEmails) {
    emails.add(email.toLowerCase());
    const d = extractDomain(email);
    if (d) domains.add(d);
    remaining = remaining.replace(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  }

  // Domain-only query (arkema.com) or domains embedded in leftover text
  const foundDomains = remaining.match(DOMAIN_REGEX) || [];
  for (const domain of foundDomains) {
    const d = domain.toLowerCase();
    domains.add(d);
    remaining = remaining.replace(new RegExp(domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
    // Also keep the registrable label as a keyword (arkema.com -> arkema)
    const label = d.split(".")[0];
    if (label && label.length >= 3) {
      remaining = `${remaining} ${label}`;
    }
  }

  if (!foundDomains.length && looksLikeDomain(remaining)) {
    const d = remaining.toLowerCase().trim();
    domains.add(d);
    const label = d.split(".")[0];
    remaining = label && label.length >= 3 ? label : "";
  }

  remaining = remaining.replace(/\s+/g, " ").trim();
  const keywords = tokenizeKeywords(remaining);

  return {
    emails: [...emails],
    domains: [...domains],
    keywords,
    freeText: remaining,
  };
}

/** Build a single searchable string for a meeting (accent-folded). */
export function meetingHaystack(meeting: SearchMeeting): string {
  const parts: string[] = [
    meeting.title || "",
    meeting.meeting_title || "",
    meeting.default_summary?.markdown_formatted || "",
    meeting.recorded_by?.name || "",
    meeting.recorded_by?.email || "",
  ];

  for (const item of meeting.action_items || []) {
    if (item.description) parts.push(item.description);
  }
  for (const attendee of meeting.calendar_invitees || []) {
    if (attendee.name) parts.push(attendee.name);
    if (attendee.email) parts.push(attendee.email);
    if (attendee.email_domain) parts.push(attendee.email_domain);
  }
  for (const entry of meeting.transcript || []) {
    if (entry.text) parts.push(entry.text);
  }

  return foldAccents(parts.join("\n"));
}

function meetingHasEmail(meeting: SearchMeeting, emails: string[]): boolean {
  if (emails.length === 0) return true;
  const wanted = new Set(emails.map((e) => e.toLowerCase()));
  const hay = meetingHaystack(meeting);

  for (const email of wanted) {
    if (hay.includes(foldAccents(email))) return true;
  }

  return (meeting.calendar_invitees || []).some((a) => {
    const email = a.email?.toLowerCase();
    return !!email && wanted.has(email);
  });
}

function meetingHasDomain(meeting: SearchMeeting, domains: string[]): boolean {
  if (domains.length === 0) return true;
  const hay = meetingHaystack(meeting);

  return domains.some((domain) => {
    const d = foldAccents(domain);
    if (hay.includes(d)) return true;

    return (meeting.calendar_invitees || []).some((a) => {
      const emailDomain = a.email_domain?.toLowerCase();
      const email = a.email?.toLowerCase() || "";
      return emailDomain === domain.toLowerCase() || email.endsWith(`@${domain.toLowerCase()}`);
    });
  });
}

function meetingHasKeywords(meeting: SearchMeeting, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const hay = meetingHaystack(meeting);
  // AND semantics: every token must appear somewhere (title, email, summary, …)
  return keywords.every((kw) => hay.includes(kw));
}

export function meetingMatchesQuery(meeting: SearchMeeting, query: ParsedSearchQuery): boolean {
  // If the query is empty, everything matches
  if (query.emails.length === 0 && query.domains.length === 0 && query.keywords.length === 0) {
    return true;
  }

  return (
    meetingHasEmail(meeting, query.emails) &&
    meetingHasDomain(meeting, query.domains) &&
    meetingHasKeywords(meeting, query.keywords)
  );
}

export function isSensitiveTeam(
  team: string | null | undefined,
  excludeTeams: Array<string | null | undefined>
): boolean {
  const recordedByTeam = team ?? null;

  return excludeTeams.some((excluded) => {
    if (excluded === null || excluded === undefined) {
      return recordedByTeam === null || recordedByTeam === undefined || recordedByTeam === "";
    }
    if (!recordedByTeam) return false;
    return recordedByTeam.toLowerCase().includes(String(excluded).toLowerCase());
  });
}

/** Default: exclude Executive/Personal only. Private / null-team calls are included. */
export const DEFAULT_EXCLUDE_TEAMS = ["Executive", "Personal"];
