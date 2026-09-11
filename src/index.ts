#!/usr/bin/env node

import { FathomClient } from "./fathom-client.js";
import {
  DEFAULT_EXCLUDE_TEAMS,
  isSensitiveTeam,
  meetingMatchesQuery,
  parseSearchQuery,
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

function authenticateSSE(req: express.Request, res: express.Response, next: express.NextFunction) {
  console.log("Authenticating MCP request...");
  console.log("Request method:", req.method);

  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    console.log("No token provided");
    res.status(401).json({ error: "Access token required" });
    return;
  }

  if (token !== bearerToken) {
    console.log("Invalid token provided");
    res.status(403).json({ error: "Invalid access token" });
    return;
  }

  console.log("Authentication successful, handling MCP request");
  handleMCPRequest(req, res);
}

async function fetchAllMeetings(apiParams: Record<string, unknown>, maxFetchLimit = 1000) {
  let allMeetings: any[] = [];
  let cursor: string | undefined = undefined;
  let totalFetched = 0;

  do {
    const response = await fathomClient.listMeetings({ ...apiParams, cursor } as any);
    allMeetings = allMeetings.concat(response.items);
    totalFetched += response.items.length;
    cursor = response.next_cursor;
    console.log(`Fetched ${response.items.length} meetings (total: ${totalFetched}), next_cursor: ${cursor}`);

    if (totalFetched >= maxFetchLimit) {
      console.log(`Reached maximum fetch limit of ${maxFetchLimit} meetings`);
      break;
    }
  } while (cursor && totalFetched < maxFetchLimit);

  return allMeetings;
}

async function handleMCPRequest(req: express.Request, res: express.Response) {
  console.log("Handling MCP request (method:", req.body?.method || "unknown", ")");

  try {
    const { method, params, id } = req.body;

    if (method === "initialize") {
      console.log("Handling initialize request");
      res.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: "mcp-fathom-server", version: "1.1.0" },
        },
      });
      return;
    }

    if (method === "notifications/initialized") {
      console.log("Handling initialized notification");
      res.status(200).json({ status: "ok" });
      return;
    }

    if (method === "tools/list") {
      console.log("Handling tools/list request");
      res.json({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "search_meetings",
              description:
                "Search Fathom meetings by keyword, company name, domain, or attendee email. Matches titles, attendees, summaries, action items, and transcripts client-side (does not rely on Fathom company association, which is often incomplete). Excludes Executive and Personal teams by default.",
              inputSchema: {
                type: "object",
                properties: {
                  search_term: {
                    type: "string",
                    description:
                      "Keyword, company name, domain (e.g. arkema.com), or email. Multi-word queries use AND matching across title/attendees/summary.",
                  },
                  limit: {
                    type: "number",
                    default: 50,
                    description: "Maximum number of meetings to return (max: 100)",
                  },
                  days_back: {
                    type: "number",
                    default: 180,
                    description: "Days to look back from today (default: 180, max: 365)",
                  },
                  created_after: {
                    type: "string",
                    format: "date-time",
                    description: "ISO 8601 lower bound. Overrides days_back if provided.",
                  },
                  created_before: {
                    type: "string",
                    format: "date-time",
                    description: "ISO 8601 upper bound",
                  },
                  exclude_teams: {
                    type: "array",
                    items: { type: "string" },
                    default: [],
                    description:
                      "Additional teams to exclude. Executive and Personal are always excluded. Private/null-team calls are included by default.",
                  },
                  exclude_private: {
                    type: "boolean",
                    default: false,
                    description: "If true, also exclude meetings with no team (private / unshared).",
                  },
                  include_transcript: {
                    type: "boolean",
                    default: false,
                    description: "Include full transcripts (can be large/slow)",
                  },
                  include_summary: {
                    type: "boolean",
                    default: true,
                    description: "Include meeting summaries",
                  },
                  include_action_items: {
                    type: "boolean",
                    default: true,
                    description: "Include action items",
                  },
                  calendar_invitees: {
                    type: "array",
                    items: { type: "string" },
                    description:
                      "Filter by attendee email (client-side). Also matches emails appearing in the meeting title.",
                  },
                  calendar_invitees_domains: {
                    type: "array",
                    items: { type: "string" },
                    description:
                      "Filter by invitee email domain client-side (e.g. arkema.com). Does NOT use Fathom's company-association API filter.",
                  },
                  recorded_by: {
                    type: "array",
                    items: { type: "string" },
                    description: "Filter by meeting owner email addresses (API filter)",
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
      console.log("Handling tools/call request:", params);
      const { name, arguments: args } = params;

      try {
        if (name !== "search_meetings") {
          throw new Error(`Unknown tool: ${name}`);
        }

        console.log(`Searching meetings for: "${args.search_term}"`);

        const rawSearchTerm = args.search_term?.toLowerCase() || "";
        const lastMatch = rawSearchTerm.match(/last\s+(\d+)|derniers?\s+(\d+)/);
        const requestedLastCount = lastMatch ? parseInt(lastMatch[1] || lastMatch[2]) : null;
        const isLastRequest = !!requestedLastCount;

        if (isLastRequest) {
          console.log(`"Last ${requestedLastCount}" request — will return only the most recent ${requestedLastCount}`);
        }

        const agentMatch = rawSearchTerm.match(/@agent\(["']?([^"')]+)["']?\)/);
        const agentToken = agentMatch ? agentMatch[1] : null;

        const explicitEmails = (args.calendar_invitees || []).filter(
          (email: string) => email.includes("@") && email.includes(".")
        );
        const invalidInvitees = (args.calendar_invitees || []).filter(
          (email: string) => !email.includes("@") || !email.includes(".")
        );
        if (invalidInvitees.length > 0) {
          console.log(`Ignoring invalid calendar_invitees (not emails): ${invalidInvitees.join(", ")}`);
        }

        const query = parseSearchQuery(
          args.search_term,
          explicitEmails,
          args.calendar_invitees_domains || [],
          agentToken
        );

        // If invalid invitee entries look like names, fold them into keywords
        if (invalidInvitees.length > 0) {
          const nameQuery = parseSearchQuery(invalidInvitees.join(" "));
          query.keywords = [...new Set([...query.keywords, ...nameQuery.keywords])];
        }

        console.log("Parsed search query:", JSON.stringify(query));

        const apiParams: Record<string, unknown> = {
          include_summary: args.include_summary !== false,
          include_action_items: args.include_action_items !== false,
          include_transcript: args.include_transcript || false,
          include_crm_matches: false,
        };

        // NOTE: Do NOT pass calendar_invitees_domains to the Fathom API.
        // That param filters by associated company (often empty/wrong), not invitee domains.
        if (args.recorded_by) {
          apiParams.recorded_by = args.recorded_by;
        }

        if (args.created_after) {
          apiParams.created_after = args.created_after;
        } else {
          const daysBack = Math.min(args.days_back || 180, 365);
          apiParams.created_after = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
          console.log(`Date filter: looking back ${daysBack} days`);
        }

        if (args.created_before) {
          apiParams.created_before = args.created_before;
        }

        console.log("API params:", JSON.stringify(apiParams, null, 2));

        // Always paginate — keyword/domain matching is client-side
        const allMeetings = await fetchAllMeetings(apiParams);
        console.log(`Got ${allMeetings.length} meetings from API`);

        const excludeTeams: Array<string | null | undefined> = [
          ...DEFAULT_EXCLUDE_TEAMS,
          ...(args.exclude_teams || []),
        ];
        if (args.exclude_private) {
          excludeTeams.push(null, undefined);
        }

        const afterSecurity = allMeetings.filter((meeting) => {
          const excluded = isSensitiveTeam(meeting.recorded_by?.team, excludeTeams);
          if (excluded) {
            console.log(
              `Excluding sensitive meeting "${meeting.title || meeting.meeting_title}" — team: "${meeting.recorded_by?.team}"`
            );
          }
          return !excluded;
        });
        console.log(
          `After team filter: ${afterSecurity.length} (excluded ${allMeetings.length - afterSecurity.length})`
        );

        let matchingMeetings = afterSecurity.filter((meeting) => meetingMatchesQuery(meeting, query));
        console.log(`Matched ${matchingMeetings.length} / ${afterSecurity.length} meetings`);

        // Prefer most recent first
        matchingMeetings = matchingMeetings.sort((a, b) => {
          const da = new Date(a.scheduled_start_time || a.created_at || 0).getTime();
          const db = new Date(b.scheduled_start_time || b.created_at || 0).getTime();
          return db - da;
        });

        let finalMeetings: any[];
        let actualLimit: number;

        if (isLastRequest && requestedLastCount) {
          finalMeetings = matchingMeetings.slice(0, requestedLastCount);
          actualLimit = requestedLastCount;
        } else {
          actualLimit = Math.min(args.limit || 50, 100);
          finalMeetings = matchingMeetings.slice(0, actualLimit);
        }

        const formattedMeetings = finalMeetings.map((meeting) => ({
          title: meeting.title || meeting.meeting_title,
          date: meeting.scheduled_start_time || meeting.created_at,
          url: meeting.share_url || meeting.url,
          attendees: meeting.calendar_invitees,
          recorded_by: meeting.recorded_by,
          summary: args.include_summary !== false ? meeting.default_summary : undefined,
          action_items: args.include_action_items !== false ? meeting.action_items : undefined,
          transcript: args.include_transcript ? meeting.transcript : undefined,
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
                    total_found: matchingMeetings.length,
                    showing: finalMeetings.length,
                    has_more: matchingMeetings.length > actualLimit,
                    filters_applied: {
                      exclude_teams: excludeTeams.filter((t) => t),
                      exclude_private: !!args.exclude_private,
                      days_back: args.days_back || 180,
                      include_summary: args.include_summary !== false,
                      include_action_items: args.include_action_items !== false,
                      include_transcript: args.include_transcript || false,
                      client_side_domain_matching: true,
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

    console.log("Unknown MCP method:", method);
    res.status(400).json({ error: `Unknown method: ${method}` });
  } catch (error) {
    console.error("Failed to handle MCP request:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

async function main() {
  console.log("Starting Fathom MCP Server...");
  console.log("Environment variables check:");
  console.log("- FATHOM_API_KEY:", apiKey ? "SET" : "NOT SET");
  console.log("- MCP_BEARER_TOKEN:", bearerToken ? "SET" : "NOT SET");

  const app = express();
  const port = process.env.PORT || 3000;
  console.log(`Using port: ${port}`);

  app.use((req, res, next) => {
    req.setTimeout(300000);
    res.setTimeout(300000);
    next();
  });

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  app.get("/health", (req, res) => {
    res.json({ status: "ok", service: "mcp-fathom-server" });
  });

  app.post("/sse", authenticateSSE);

  const server = app.listen(port, () => {
    console.log(`Fathom MCP Server running on port ${port}`);
    console.log(`SSE endpoint available at: http://localhost:${port}/sse`);
    console.log(`Health check available at: http://localhost:${port}/health`);
  });

  server.keepAliveTimeout = 300000;
  server.headersTimeout = 300000;
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
