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
  ListPromptsRequest
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

if (!apiKey) {
  console.error("Error: FATHOM_API_KEY environment variable is required");
  process.exit(1);
}

if (!bearerToken) {
  console.error("Error: MCP_BEARER_TOKEN environment variable is required");
  process.exit(1);
}

const fathomClient = new FathomClient(apiKey);

// Bearer token authentication middleware for SSE
function authenticateSSE(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  if (token !== bearerToken) {
    res.status(403).json({ error: 'Invalid access token' });
    return;
  }

  // Don't call next() - we'll handle the SSE setup directly
  handleSSEConnection(req, res);
}

// Handle SSE connection setup
async function handleSSEConnection(req: express.Request, res: express.Response) {
  console.log('New SSE connection established');
  
  // Create SSE transport - it will handle headers internally
  const transport = new SSEServerTransport('/sse', res);
  
  try {
    await server.connect(transport);
    console.log('MCP Server connected to SSE transport');
  } catch (error) {
    console.error('Failed to connect MCP server to SSE transport:', error);
    res.end();
  }

  // Handle client disconnect
  req.on('close', () => {
    console.log('SSE connection closed');
    transport.close();
  });
}

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

// Add stub handlers for resources and prompts to prevent "Method not found" errors
server.setRequestHandler(ListResourcesRequestSchema, async (request: ListResourcesRequest) => ({
  resources: []
}));

server.setRequestHandler(ListPromptsRequestSchema, async (request: ListPromptsRequest) => ({
  prompts: []
}));

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

async function main() {
  const app = express();
  const port = process.env.PORT || 3000;

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Health check endpoint (no auth required)
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'mcp-fathom-server' });
  });

  // SSE endpoint with bearer token authentication
  app.get('/sse', authenticateSSE);
  app.post('/sse', authenticateSSE);

  app.listen(port, () => {
    console.log(`Fathom MCP Server running on port ${port}`);
    console.log(`SSE endpoint available at: http://localhost:${port}/sse`);
    console.log(`Health check available at: http://localhost:${port}/health`);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});