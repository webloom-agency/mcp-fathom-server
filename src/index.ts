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

// Bearer token authentication middleware for SSE
function authenticateSSE(req: express.Request, res: express.Response, next: express.NextFunction) {
  console.log('Authenticating SSE request...');
  console.log('Request method:', req.method);
  console.log('Request headers:', JSON.stringify(req.headers, null, 2));
  
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

  console.log('Authentication successful, proceeding to SSE setup');
  
  // Handle POST requests with MCP initialization immediately
  if (req.method === 'POST' && req.body && req.body.method === 'initialize') {
    console.log('Handling MCP initialization request immediately...');
    const response = {
      jsonrpc: '2.0',
      id: req.body.id,
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
    console.log('Sending MCP initialization response:', JSON.stringify(response, null, 2));
    res.json(response);
    return;
  }
  
  // For GET requests or other POST requests, handle as SSE connection
  handleSSEConnection(req, res);
}

// Handle SSE connection setup
async function handleSSEConnection(req: express.Request, res: express.Response) {
  console.log('New SSE connection established');
  console.log('Request body:', req.body);
  console.log('Request content-type:', req.headers['content-type']);
  
  try {
    // Set keep-alive headers immediately
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Keep-Alive', 'timeout=300, max=1000');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
    
    // Create SSE transport first to establish connection quickly
    console.log('Creating SSE transport...');
    const transport = new SSEServerTransport('/sse', res);
    console.log('SSE transport created');
    
    // Create server and set up handlers asynchronously
    console.log('Creating new MCP server instance...');
    const server = createMCPServer();
    console.log('MCP server instance created');
    
    // Set up the server handlers
    console.log('Setting up server handlers...');
    setupServerHandlers(server);
    console.log('Server handlers set up');
    
    console.log('Connecting server to transport...');
    await server.connect(transport);
    console.log('MCP Server connected to SSE transport successfully');
    
    // The SSE transport should handle MCP protocol messages automatically
    // We just need to ensure the connection is established properly
    
    // Set up heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      try {
        res.write('data: {"type":"heartbeat","timestamp":' + Date.now() + '}\n\n');
      } catch (error) {
        console.log('Heartbeat failed, connection likely closed');
        clearInterval(heartbeat);
      }
    }, 30000); // Every 30 seconds
    
    // Handle client disconnect
    req.on('close', () => {
      console.log('SSE connection closed');
      clearInterval(heartbeat);
      transport.close();
    });
    
    req.on('error', (error) => {
      console.error('SSE connection error:', error);
      clearInterval(heartbeat);
      transport.close();
    });
    
    // Keep the connection alive
    console.log('SSE connection established and ready for MCP communication');
    
  } catch (error) {
    console.error('Failed to connect MCP server to SSE transport:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to establish SSE connection' });
    }
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

  // SSE endpoint with bearer token authentication
  console.log('Setting up SSE routes...');
  app.get('/sse', authenticateSSE);
  app.post('/sse', authenticateSSE);
  console.log('SSE routes set up');

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