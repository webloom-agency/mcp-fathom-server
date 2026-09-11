#!/usr/bin/env node

import { FathomClient } from "./fathom-client.js";
import {
  DEFAULT_EXCLUDE_TEAMS,
  isSensitiveTeam,
  meetingMatchesQuery,
  parseSearchQuery,
  type ParsedSearchQuery,
} from "./search.js";
import express from "express";
import cors from "cors";

const apiKey = process.env.FATHOM_API_KEY;
const bearerToken = process.env.MCP_BEARER_TOKEN;

process.env.MCP_TIMEOUT = process.env.MCP_TIMEOUT || "300000";

if (!apiKey) {
  console.error("Error: FATHOM_API_KEY environment variable is required");
  process.exit(1);
}

if (!bearerToken) {
  console.error("Error: MCP_BEARER_TOKEN environment variable is required");
  process.exit(1);
}

const fathomClient = new FathomClient(apiKey);

function authenticateSSE(req: express.Request, res: express.Response, _next: express.NextFunction) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    res.status(401).json({ error: "Access token required" });
    return;
  }

  if (token !== bearerToken) {
    res.status(403).json({ error: "Invalid access token" });
    return;
  }

  handleMCPRequest(req, res);
}

/**
 * Fathom has no native keyword search. We list meetings in a bounded date
 * window (lightweight: no summary/transcript), match client-side, and stop
 * as soon as we have enough hits. Summaries are fetched only for returned rows.
 */
async function scanMeetingsForQuery(options: {
  apiParams: Record<string, unknown>;
  query: ParsedSearchQuery;
  excludeTeams: Array<string | null | undefined>;
  matchTarget: number;
  maxScan: number;
}) {
  const { apiParams, query, excludeTeams, matchTarget, maxScan } = options;

  const matches: any[] = [];
  let cursor: string | undefined;
  let scanned = 0;
  let pages = 0;
  let stoppedEarly = false;

  do {
    const response = await fathomClient.listMeetings({ ...apiParams, cursor } as any);
    pages += 1;
    scanned += response.items.length;
    cursor = response.next_cursor || undefined;

    for (const meeting of response.items) {
      if (isSensitiveTeam(meeting.recorded_by?.team, excludeTeams)) continue;
      if (meetingMatchesQuery(meeting, query)) {
        matches.push(meeting);
      }
    }

    console.log(
      `Scan page ${pages}: scanned=${scanned} matches=${matches.length} more=${Boolean(cursor)}`
    );

    if (matches.length >= matchTarget) {
      stoppedEarly = true;
      break;
    }
    if (scanned >= maxScan) {
      stoppedEarly = true;
      console.log(`Hit maxScan=${maxScan}`);
      break;
    }
  } while (cursor);

  matches.sort((a, b) => {
    const da = new Date(a.scheduled_start_time || a.created_at || 0).getTime();
    const db = new Date(b.scheduled_start_time || b.created_at || 0).getTime();
    return db - da;
  });

  return {
    matches,
    scanned,
    pages,
    truncated: stoppedEarly || Boolean(cursor),
  };
}

async function enrichMeetings(
  meetings: any[],
  opts: { includeSummary: boolean; includeTranscript: boolean }
) {
  const enriched = [];
  for (const meeting of meetings) {
    const copy = { ...meeting };
    try {
      if (opts.includeSummary && meeting.recording_id && !meeting.default_summary) {
        copy.default_summary = await fathomClient.getSummary(meeting.recording_id);
      }
      if (opts.includeTranscript && meeting.recording_id) {
        copy.transcript = await fathomClient.getTranscript(meeting.recording_id);
      }
    } catch (err) {
      console.warn(
        `Enrichment failed for recording ${meeting.recording_id}:`,
        err instanceof Error ? err.message : err
      );
    }
    enriched.push(copy);
  }
  return enriched;
}

/** Cap how many lightweight list pages we walk for a given window. */
function maxScanForDaysBack(daysBack: number): number {
  // ~2–3 meetings/day upper bound for an agency; keep API calls modest.
  return Math.min(250, Math.max(40, daysBack * 2));
}

async function handleMCPRequest(req: express.Request, res: express.Response) {
  try {
    const { method, params, id } = req.body;

    if (method === "initialize") {
      res.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: "mcp-fathom-server", version: "1.2.0" },
        },
      });
      return;
    }

    if (method === "notifications/initialized") {
      res.status(200).json({ status: "ok" });
      return;
    }

    if (method === "tools/list") {
      res.json({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "search_meetings",
              description:
                "Find Fathom meetings by company name, domain, email, or keyword in titles/attendees. IMPORTANT: Fathom has NO native text search — each call scans a date window page-by-page and can hit rate limits if days_back is large. ALWAYS set days_back from the user's timeframe: yesterday/this week/recent → 14; this month → 30; this quarter → 90; only use 180–365 when the user explicitly asks for older history. Start with a small window and widen only if zero results. Prefer search_term like 'arkema' or 'arkema.com' (do not combine huge days_back with include_transcript=true). Default days_back is 30. Excludes Executive/Personal teams.",
              inputSchema: {
                type: "object",
                properties: {
                  search_term: {
                    type: "string",
                    description:
                      "Company, domain (arkema.com), email, or keyword. Example: 'arkema' or 'cecile.dourthe@arkema.com'. Multi-word = AND on title/attendees.",
                  },
                  limit: {
                    type: "number",
                    default: 10,
                    description:
                      "Max meetings to return (default 10, max 50). Use 5–10 unless the user wants many results.",
                  },
                  days_back: {
                    type: "number",
                    default: 30,
                    description:
                      "REQUIRED TO CHOOSE INTENTIONALLY. Days to scan (default 30, max 365). Rules: recent/yesterday/last week → 14; this month → 30; older → 90; full year ONLY if user asks. Large values = more API calls and rate-limit risk.",
                  },
                  created_after: {
                    type: "string",
                    format: "date-time",
                    description: "ISO lower bound; overrides days_back when you know an exact start date.",
                  },
                  created_before: {
                    type: "string",
                    format: "date-time",
                    description: "ISO upper bound",
                  },
                  exclude_teams: {
                    type: "array",
                    items: { type: "string" },
                    default: [],
                    description: "Extra teams to exclude. Executive/Personal always excluded.",
                  },
                  exclude_private: {
                    type: "boolean",
                    default: false,
                    description: "Exclude meetings with no team.",
                  },
                  include_transcript: {
                    type: "boolean",
                    default: false,
                    description:
                      "Fetch transcripts ONLY for returned hits. Default false. Heavy/rate-limited — set true only when the user needs exact quotes.",
                  },
                  include_summary: {
                    type: "boolean",
                    default: true,
                    description:
                      "Fetch summaries only for returned hits (1 heavy call per hit). Keep true for analysis; set false for a cheap existence check.",
                  },
                  include_action_items: {
                    type: "boolean",
                    default: true,
                    description: "Include action items from the list scan (not a heavy request).",
                  },
                  calendar_invitees: {
                    type: "array",
                    items: { type: "string" },
                    description:
                      "Optional attendee emails. Prefer putting the company/domain in search_term first; add email if known.",
                  },
                  calendar_invitees_domains: {
                    type: "array",
                    items: { type: "string" },
                    description:
                      "Optional invitee domains (client-side). Usually redundant if search_term is already 'arkema.com'.",
                  },
                  recorded_by: {
                    type: "array",
                    items: { type: "string" },
                    description: "Recorder emails — native API filter; use when you know who recorded.",
                  },
                },
                required: ["search_term"],
              },
            },
          ],
        },
      });
      return;
    }

    if (method === "tools/call") {
      const { name, arguments: args } = params;

      try {
        if (name !== "search_meetings") {
          throw new Error(`Unknown tool: ${name}`);
        }

        const rawSearchTerm = args.search_term?.toLowerCase() || "";
        const lastMatch = rawSearchTerm.match(/last\s+(\d+)|derniers?\s+(\d+)/);
        const requestedLastCount = lastMatch ? parseInt(lastMatch[1] || lastMatch[2]) : null;
        const isLastRequest = !!requestedLastCount;

        const agentMatch = rawSearchTerm.match(/@agent\(["']?([^"')]+)["']?\)/);
        const agentToken = agentMatch ? agentMatch[1] : null;

        const explicitEmails = (args.calendar_invitees || []).filter(
          (email: string) => email.includes("@") && email.includes(".")
        );
        const invalidInvitees = (args.calendar_invitees || []).filter(
          (email: string) => !email.includes("@") || !email.includes(".")
        );

        const query = parseSearchQuery(
          args.search_term,
          explicitEmails,
          args.calendar_invitees_domains || [],
          agentToken
        );

        if (invalidInvitees.length > 0) {
          const nameQuery = parseSearchQuery(invalidInvitees.join(" "));
          query.keywords = [...new Set([...query.keywords, ...nameQuery.keywords])];
        }

        const daysBack = args.created_after
          ? null
          : Math.min(Math.max(args.days_back ?? 30, 1), 365);
        const actualLimit = Math.min(
          isLastRequest && requestedLastCount ? requestedLastCount : args.limit || 10,
          50
        );

        // Lightweight list only — summaries/transcripts are heavy (≤30/min).
        const apiParams: Record<string, unknown> = {
          include_summary: false,
          include_transcript: false,
          include_action_items: args.include_action_items !== false,
          include_crm_matches: false,
        };

        if (args.recorded_by) apiParams.recorded_by = args.recorded_by;

        if (args.created_after) {
          apiParams.created_after = args.created_after;
        } else {
          apiParams.created_after = new Date(
            Date.now() - (daysBack as number) * 24 * 60 * 60 * 1000
          ).toISOString();
        }
        if (args.created_before) apiParams.created_before = args.created_before;

        const excludeTeams: Array<string | null | undefined> = [
          ...DEFAULT_EXCLUDE_TEAMS,
          ...(args.exclude_teams || []),
        ];
        if (args.exclude_private) excludeTeams.push(null, undefined);

        const maxScan = maxScanForDaysBack(daysBack ?? 30);
        // Fetch a few extra matches so has_more is meaningful, then slice.
        const matchTarget = Math.min(actualLimit + 5, 50);

        console.log(
          `Search "${args.search_term}" query=${JSON.stringify(query)} days_back=${daysBack} limit=${actualLimit} maxScan=${maxScan}`
        );

        const { matches, scanned, pages, truncated } = await scanMeetingsForQuery({
          apiParams,
          query,
          excludeTeams,
          matchTarget,
          maxScan,
        });

        const finalMeetings = matches.slice(0, actualLimit);
        const wantSummary = args.include_summary !== false;
        const wantTranscript = !!args.include_transcript;

        const enriched = await enrichMeetings(finalMeetings, {
          includeSummary: wantSummary,
          includeTranscript: wantTranscript,
        });

        const formattedMeetings = enriched.map((meeting) => ({
          title: meeting.title || meeting.meeting_title,
          date: meeting.scheduled_start_time || meeting.created_at,
          url: meeting.share_url || meeting.url,
          recording_id: meeting.recording_id,
          attendees: meeting.calendar_invitees,
          recorded_by: meeting.recorded_by,
          summary: wantSummary ? meeting.default_summary : undefined,
          action_items: args.include_action_items !== false ? meeting.action_items : undefined,
          transcript: wantTranscript ? meeting.transcript : undefined,
        }));

        res.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    search_term: args.search_term,
                    parsed_query: query,
                    total_found: matches.length,
                    showing: formattedMeetings.length,
                    has_more: matches.length > actualLimit || truncated,
                    scan: {
                      meetings_scanned: scanned,
                      pages,
                      max_scan: maxScan,
                      truncated,
                      note: "Fathom has no native text search; scan is a bounded lightweight list + client filter.",
                    },
                    filters_applied: {
                      exclude_teams: excludeTeams.filter((t) => t),
                      exclude_private: !!args.exclude_private,
                      days_back: daysBack ?? undefined,
                      include_summary: wantSummary,
                      include_action_items: args.include_action_items !== false,
                      include_transcript: wantTranscript,
                    },
                    meetings: formattedMeetings,
                  },
                  null,
                  2
                ),
              },
            ],
          },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
        console.error(`Error in ${name}:`, errorMessage);
        res.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32603, message: errorMessage },
        });
      }
      return;
    }

    res.status(400).json({ error: `Unknown method: ${method}` });
  } catch (error) {
    console.error("Failed to handle MCP request:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

async function main() {
  const app = express();
  const port = process.env.PORT || 3000;

  app.use((req, res, next) => {
    req.setTimeout(300000);
    res.setTimeout(300000);
    next();
  });

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "mcp-fathom-server" });
  });

  app.post("/sse", authenticateSSE);

  const server = app.listen(port, () => {
    console.log(`Fathom MCP Server on port ${port}`);
  });

  server.keepAliveTimeout = 300000;
  server.headersTimeout = 300000;
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
