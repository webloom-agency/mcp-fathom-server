#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { 
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListToolsRequest,
  CallToolRequest,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequest,
  ListPromptsRequest,
  InitializeRequestSchema,
  InitializeRequest
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { FathomClient } from "./fathom-client.js";
import express from "express";
import cors from "cors";

const ListMeetingsSchema = z.object({
  calendar_invitees: z.array(z.string()).optional().describe("Filter by attendee email addresses"),
  calendar_invitees_domains: z.array(z.string()).optional().describe("Filter by company domains"),
  created_after: z.string().optional().describe("Filter meetings created after this date (ISO 8601)"),
  created_before: z.string().optional().describe("Filter meetings created before this date (ISO 8601)"),
  include_transcript: z.boolean().optional().default(false).describe("Include meeting transcripts"),
  meeting_type: z.enum(['all', 'internal', 'external']).optional().default('all').describe("Filter by meeting type"),
  recorded_by: z.array(z.string()).optional().describe("Filter by meeting owner email addresses"),
  teams: z.array(z.string()).optional().describe("Filter by team names"),
  limit: z.number().optional().default(50).describe("Maximum number of meetings to return")
});

const SearchMeetingsSchema = z.object({
  search_term: z.string().describe("Search term to find in meeting titles, summaries, or action items"),
  include_transcript: z.boolean().optional().default(false).describe("Whether to search within transcripts (WARNING: Currently disabled for performance)")
});

// Environment variables validation
const apiKey = process.env.FATHOM_API_KEY;
const bearerToken = process.env.MCP_BEARER_TOKEN;

// Set MCP timeout environment variable
process.env.MCP_TIMEOUT = process.env.MCP_TIMEOUT || '300000'; // 5 minutes

if (!apiKey) {
  console.error("Error: FATHOM_API_KEY environment variable is required");
  process.exit(1);
}

if (!bearerToken) {
  console.error("Error: MCP_BEARER_TOKEN environment variable is required");
  process.exit(1);
}

const fathomClient = new FathomClient(apiKey);

// Create a new MCP server instance for each connection
function createMCPServer() {
  const server = new Server({
    name: "mcp-fathom-server",
    version: "1.0.0"
  }, {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {}
    }
  });

  return server;
}

// Simple MCP server instance
let mcpServer: Server | null = null;

// Bearer token authentication middleware
function authenticateSSE(req: express.Request, res: express.Response, next: express.NextFunction) {
  console.log('Authenticating MCP request...');
  console.log('Request method:', req.method);
  console.log('Request body:', req.body);
  
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    console.log('No token provided');
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  if (token !== bearerToken) {
    console.log('Invalid token provided');
    res.status(403).json({ error: 'Invalid access token' });
    return;
  }

  console.log('Authentication successful, handling MCP request');
  
  // Handle MCP protocol messages directly
  handleMCPRequest(req, res);
}

// Handle MCP protocol requests directly
async function handleMCPRequest(req: express.Request, res: express.Response) {
  console.log('Handling MCP request:', req.body);
  
  try {
    // Initialize MCP server if not already done
    if (!mcpServer) {
      console.log('Creating MCP server instance...');
      mcpServer = createMCPServer();
      setupServerHandlers(mcpServer);
      console.log('MCP server initialized');
    }
    
    const { method, params, id } = req.body;
    
    // Handle different MCP protocol messages
    if (method === 'initialize') {
      console.log('Handling initialize request');
      const response = {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
            resources: {},
            prompts: {}
          },
          serverInfo: {
            name: 'mcp-fathom-server',
            version: '1.0.0'
          }
        }
      };
      console.log('Sending initialize response:', JSON.stringify(response, null, 2));
      res.json(response);
      
    } else if (method === 'notifications/initialized') {
      console.log('Handling initialized notification');
      res.status(200).json({ status: 'ok' });
      
    } else if (method === 'tools/list') {
      console.log('Handling tools/list request');
      const response = {
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name: "search_meetings",
              description: "Search for Fathom meetings with comprehensive filtering. Can search by keywords in titles, summaries, action items, or attendees. Includes summaries, action items, and optional transcripts. Automatically excludes Executive and Personal teams.",
              inputSchema: {
                type: "object",
                properties: {
                  search_term: {
                    type: "string",
                    description: "Search term to find in meeting titles, summaries, action items, or attendee names"
                  },
                  limit: {
                    type: "number",
                    default: 50,
                    description: "Maximum number of meetings to return (max: 100)"
                  },
                  days_back: {
                    type: "number",
                    default: 180,
                    description: "Number of days to look back from today (default: 180, max: 365)"
                  },
                  created_after: {
                    type: "string",
                    format: "date-time",
                    description: "Filter meetings created after this date (ISO 8601 format). Overrides days_back if provided."
                  },
                  created_before: {
                    type: "string",
                    format: "date-time",
                    description: "Filter meetings created before this date (ISO 8601 format)"
                  },
                  exclude_teams: {
                    type: "array",
                    items: { type: "string" },
                    default: ["Executive", "Personal"],
                    description: "Teams to exclude from results (default: ['Executive', 'Personal'])"
                  },
                  include_transcript: {
                    type: "boolean",
                    default: false,
                    description: "Whether to include full transcripts (WARNING: Can be very large and slow)"
                  },
                  include_summary: {
                    type: "boolean",
                    default: true,
                    description: "Whether to include meeting summaries"
                  },
                  include_action_items: {
                    type: "boolean",
                    default: true,
                    description: "Whether to include action items"
                  },
                  calendar_invitees: {
                    type: "array",
                    items: { type: "string" },
                    description: "Filter by attendee email addresses"
                  },
                  calendar_invitees_domains: {
                    type: "array", 
                    items: { type: "string" },
                    description: "Filter by company domains"
                  },
                  recorded_by: {
                    type: "array",
                    items: { type: "string" },
                    description: "Filter by meeting owner email addresses"
                  }
                },
                required: ["search_term"]
              }
            }
          ]
        }
      };
      console.log('Sending tools/list response');
      res.json(response);
      
    } else if (method === 'tools/call') {
      console.log('Handling tools/call request:', params);
      const { name, arguments: args } = params;
      
      try {
        if (name === "search_meetings") {
          console.log(`Searching for: "${args.search_term}" with comprehensive filtering`);
          
          // Build API parameters with proper includes
          const apiParams: any = {
            include_summary: args.include_summary !== false, // Default to true
            include_action_items: args.include_action_items !== false, // Default to true
            include_transcript: args.include_transcript || false,
            include_crm_matches: false // We don't need CRM data for search
          };

          // Handle date filtering
          if (args.created_after) {
            apiParams.created_after = args.created_after;
          } else if (args.days_back) {
            const daysBack = Math.min(args.days_back, 365); // Cap at 1 year
            apiParams.created_after = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
          } else {
            // Default to 180 days
            apiParams.created_after = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
          }

          if (args.created_before) {
            apiParams.created_before = args.created_before;
          }

          // Add other filters
          if (args.calendar_invitees) apiParams.calendar_invitees = args.calendar_invitees;
          if (args.calendar_invitees_domains) apiParams.calendar_invitees_domains = args.calendar_invitees_domains;
          if (args.recorded_by) apiParams.recorded_by = args.recorded_by;

          console.log('API params:', JSON.stringify(apiParams, null, 2));

          // Get meetings from API with proper includes
          const response = await fathomClient.listMeetings(apiParams);
          console.log(`Got ${response.items.length} meetings from API`);

          // Filter out excluded teams
          const excludeTeams = args.exclude_teams || ["Executive", "Personal"];
          let filteredMeetings = response.items.filter(meeting => {
            const recordedByTeam = meeting.recorded_by?.team;
            const isExcluded = excludeTeams.some(team => 
              recordedByTeam?.toLowerCase().includes(team.toLowerCase())
            );
            return !isExcluded;
          });
          console.log(`After team filtering: ${filteredMeetings.length} meetings`);

          // Search within the filtered meetings
          const searchLower = args.search_term.toLowerCase();
          const matchingMeetings = filteredMeetings.filter(meeting => {
            const titleMatch = meeting.title?.toLowerCase().includes(searchLower) ||
                              meeting.meeting_title?.toLowerCase().includes(searchLower);
            const summaryMatch = meeting.default_summary?.markdown_formatted?.toLowerCase().includes(searchLower);
            const actionItemsMatch = meeting.action_items?.some(item => 
              item.description?.toLowerCase().includes(searchLower)
            );
            const attendeeMatch = meeting.calendar_invitees?.some(attendee =>
              attendee.name?.toLowerCase().includes(searchLower) ||
              attendee.email?.toLowerCase().includes(searchLower)
            );

            return titleMatch || summaryMatch || actionItemsMatch || attendeeMatch;
          });

          console.log(`Found ${matchingMeetings.length} matching meetings`);

          // Apply limit
          const limit = Math.min(args.limit || 50, 100);
          const limitedMeetings = matchingMeetings.slice(0, limit);

          const formattedMeetings = limitedMeetings.map(meeting => ({
            title: meeting.title || meeting.meeting_title,
            date: meeting.scheduled_start_time || meeting.created_at,
            url: meeting.share_url || meeting.url,
            attendees: meeting.calendar_invitees,
            recorded_by: meeting.recorded_by,
            summary: args.include_summary !== false ? meeting.default_summary : undefined,
            action_items: args.include_action_items !== false ? meeting.action_items : undefined,
            transcript: args.include_transcript ? meeting.transcript : undefined
          }));

          const result = {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{
                type: "text",
                text: JSON.stringify({
                  search_term: args.search_term,
                  total_found: matchingMeetings.length,
                  showing: limitedMeetings.length,
                  has_more: matchingMeetings.length > limit,
                  filters_applied: {
                    exclude_teams: excludeTeams,
                    days_back: args.days_back || 180,
                    include_summary: args.include_summary !== false,
                    include_action_items: args.include_action_items !== false,
                    include_transcript: args.include_transcript || false
                  },
                  meetings: formattedMeetings
                }, null, 2)
              }]
            }
          };
          res.json(result);
        } else {
          throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
        console.error(`Error in ${name}:`, errorMessage);
        
        const result = {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32603,
            message: errorMessage
          }
        };
        res.json(result);
      }
      
    } else {
      console.log('Unknown MCP method:', method);
      res.status(400).json({ error: `Unknown method: ${method}` });
    }
    
  } catch (error) {
    console.error('Failed to handle MCP request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Set up server handlers
function setupServerHandlers(server: Server) {
  console.log('Setting up InitializeRequestSchema handler...');
  server.setRequestHandler(InitializeRequestSchema, async (request: InitializeRequest) => {
    console.log('Initialize request received:', JSON.stringify(request, null, 2));
    return {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      },
      serverInfo: {
        name: "mcp-fathom-server",
        version: "1.0.0"
      }
    };
  });
  console.log('InitializeRequestSchema handler set up');

  console.log('Setting up ListToolsRequestSchema handler...');
  server.setRequestHandler(ListToolsRequestSchema, async (request: ListToolsRequest) => ({
    tools: [
      {
        name: "list_meetings",
        description: "List Fathom meetings with optional filters. Returns meeting titles, summaries, dates, and participants.",
        inputSchema: zodToJsonSchema(ListMeetingsSchema)
      },
      {
        name: "search_meetings",
        description: "Search for meetings containing keywords in titles, summaries, or action items. NOTE: Searches last 30 days only. For better performance, transcript search is disabled by default.",
        inputSchema: zodToJsonSchema(SearchMeetingsSchema)
      }
    ]
  }));
  console.log('ListToolsRequestSchema handler set up');

  // Add stub handlers for resources and prompts to prevent "Method not found" errors
  console.log('Setting up ListResourcesRequestSchema handler...');
  server.setRequestHandler(ListResourcesRequestSchema, async (request: ListResourcesRequest) => ({
    resources: []
  }));
  console.log('ListResourcesRequestSchema handler set up');

  console.log('Setting up ListPromptsRequestSchema handler...');
  server.setRequestHandler(ListPromptsRequestSchema, async (request: ListPromptsRequest) => ({
    prompts: []
  }));
  console.log('ListPromptsRequestSchema handler set up');

  console.log('Setting up CallToolRequestSchema handler...');
  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    const { name, arguments: args } = request.params;
    
    try {
      if (name === "list_meetings") {
        const params = ListMeetingsSchema.parse(args);
        const limit = params.limit || 50;
        const { limit: _, ...apiParams } = params;
        
        console.error(`[list_meetings] Fetching meetings with params:`, JSON.stringify(apiParams));
        const response = await fathomClient.listMeetings(apiParams);
        console.error(`[list_meetings] Got ${response.items.length} meetings`);
        const meetings = response.items.slice(0, limit);
        
        const formattedMeetings = meetings.map(meeting => ({
          title: meeting.title || meeting.meeting_title,
          date: meeting.scheduled_start_time || meeting.created_at,
          url: meeting.share_url || meeting.url,
          attendees: meeting.calendar_invitees,
          recorded_by: meeting.recorded_by,
          summary: meeting.default_summary,
          action_items: meeting.action_items,
          transcript: params.include_transcript ? meeting.transcript : undefined
        }));
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              total_found: response.items.length,
              showing: meetings.length,
              meetings: formattedMeetings,
              has_more: !!response.next_cursor
            }, null, 2)
          }]
        };
      }
      
      if (name === "search_meetings") {
        const params = SearchMeetingsSchema.parse(args);
        
        console.error(`[search_meetings] Searching for: "${params.search_term}" (transcript=${params.include_transcript})`);
        const meetings = await fathomClient.searchMeetings(
          params.search_term, 
          params.include_transcript
        );
        console.error(`[search_meetings] Found ${meetings.length} matching meetings`);
        
        const formattedMeetings = meetings.map(meeting => ({
          title: meeting.title || meeting.meeting_title,
          date: meeting.scheduled_start_time || meeting.created_at,
          url: meeting.share_url || meeting.url,
          attendees: meeting.calendar_invitees,
          recorded_by: meeting.recorded_by,
          summary: meeting.default_summary,
          action_items: meeting.action_items,
          relevance: params.include_transcript && meeting.transcript?.toLowerCase().includes(params.search_term.toLowerCase()) 
            ? "Found in transcript" 
            : "Found in title/summary"
        }));
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              search_term: params.search_term,
              total_found: meetings.length,
              meetings: formattedMeetings
            }, null, 2)
          }]
        };
      }
      
      throw new Error(`Unknown tool: ${name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      console.error(`Error in ${name}:`, errorMessage);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ error: errorMessage }, null, 2)
        }],
        isError: true
      };
    }
  });
  console.log('CallToolRequestSchema handler set up');
  console.log('All server handlers set up successfully');
}

async function main() {
  console.log('Starting Fathom MCP Server...');
  console.log('Environment variables check:');
  console.log('- FATHOM_API_KEY:', apiKey ? 'SET' : 'NOT SET');
  console.log('- MCP_BEARER_TOKEN:', bearerToken ? 'SET' : 'NOT SET');
  
  const app = express();
  const port = process.env.PORT || 3000;
  console.log(`Using port: ${port}`);

  // Set server timeouts
  app.use((req, res, next) => {
    req.setTimeout(300000); // 5 minutes
    res.setTimeout(300000); // 5 minutes
    next();
  });

  // Middleware
  console.log('Setting up middleware...');
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  console.log('Middleware set up');

  // Health check endpoint (no auth required)
  app.get('/health', (req, res) => {
    console.log('Health check requested');
    res.json({ status: 'ok', service: 'mcp-fathom-server' });
  });

  // MCP endpoint with bearer token authentication
  console.log('Setting up MCP routes...');
  app.post('/sse', authenticateSSE);
  console.log('MCP routes set up');

  console.log('Starting server...');
  const server = app.listen(port, () => {
    console.log(`Fathom MCP Server running on port ${port}`);
    console.log(`SSE endpoint available at: http://localhost:${port}/sse`);
    console.log(`Health check available at: http://localhost:${port}/health`);
    console.log('Server startup complete');
  });

  // Set server timeouts
  server.keepAliveTimeout = 300000; // 5 minutes
  server.headersTimeout = 300000; // 5 minutes
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});