#!/usr/bin/env node

import { FathomClient } from "./fathom-client.js";
import express from "express";
import cors from "cors";

// Note: We're using HTTP-based MCP protocol, so no schema validation needed

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

// Note: We're using HTTP-based MCP protocol, so no MCP server instance needed

// Bearer token authentication middleware
function authenticateSSE(req: express.Request, res: express.Response, next: express.NextFunction) {
  console.log('Authenticating MCP request...');
  console.log('Request method:', req.method);
  // Note: Not logging request body to avoid exposing sensitive data
  
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
  console.log('Handling MCP request (method:', req.body?.method || 'unknown', ')');
  
  try {
    // Note: We're using HTTP-based MCP protocol, so no server initialization needed
    
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
              description: "Search for Fathom meetings with comprehensive filtering. Can search by keywords in titles, summaries, action items, or attendees. Includes summaries, action items, and optional transcripts. SECURITY: Automatically excludes Executive, Personal, No Team, and private calls (hardcoded for security).",
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
                    default: [],
                    description: "Additional teams to exclude from results. NOTE: Executive, Personal, No Team, and private calls are ALWAYS excluded for security (hardcoded)."
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
          console.log(`Filtering meetings with: "${args.search_term}" using native API filters`);
          
          // Detect "last X" requests and adjust strategy
          const searchTerm = args.search_term?.toLowerCase() || '';
          const lastMatch = searchTerm.match(/last\s+(\d+)|derniers?\s+(\d+)/);
          const requestedLastCount = lastMatch ? parseInt(lastMatch[1] || lastMatch[2]) : null;
          
          let isLastRequest = false;
          if (requestedLastCount) {
            isLastRequest = true;
            console.log(`🔄 "Last ${requestedLastCount}" request detected - will fetch ALL matching meetings then return only the last ${requestedLastCount}`);
          }
          
          // Detect agent specification in search term (e.g., "caats.co" from @agent("caats.co"))
          const agentMatch = searchTerm.match(/@agent\(["']?([^"')]+)["']?\)/);
          const agentEmail = agentMatch ? agentMatch[1] : null;
          
          if (agentEmail) {
            console.log(`🤖 Agent detected: ${agentEmail} - will use as email filter instead of keyword search`);
          }
          
          // Build API parameters with native filtering
          const apiParams: any = {
            include_summary: args.include_summary !== false, // Default to true
            include_action_items: args.include_action_items !== false, // Default to true
            include_transcript: args.include_transcript || false,
            include_crm_matches: false, // We don't need CRM data for search
            limit: 100 // High limit to get comprehensive results
          };

          // Handle date filtering
          if (args.created_after) {
            apiParams.created_after = args.created_after;
          } else if (args.days_back) {
            const daysBack = Math.min(args.days_back, 365); // Cap at 1 year
            apiParams.created_after = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
            console.log(`Date filter: looking back ${daysBack} days from ${new Date().toISOString()}`);
          } else {
            // Default to 180 days
            apiParams.created_after = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
            console.log(`Date filter: default 180 days back from ${new Date().toISOString()}`);
          }

          if (args.created_before) {
            apiParams.created_before = args.created_before;
          }

          // Use search_term as native API filters
          if (args.search_term) {
            const searchTerm = args.search_term.toLowerCase();
            
            // If agent email was detected, use it as email filter
            if (agentEmail) {
              if (agentEmail.includes('@')) {
                apiParams.calendar_invitees = [agentEmail];
                console.log(`🤖 Using agent email as filter: ${agentEmail}`);
              } else {
                // If agent is a domain, use domain filter
                apiParams.calendar_invitees_domains = [agentEmail];
                console.log(`🤖 Using agent domain as filter: ${agentEmail}`);
              }
            }
            // If search term looks like an email address (contains @), filter by email
            else if (searchTerm.includes('@')) {
              apiParams.calendar_invitees = [searchTerm];
              console.log(`Using search term as email filter: ${searchTerm}`);
            }
            // If search term looks like a domain (contains . but no @ and no spaces), filter by domain
            else if (searchTerm.includes('.') && !searchTerm.includes('@') && !searchTerm.includes(' ')) {
              apiParams.calendar_invitees_domains = [searchTerm];
              console.log(`Using search term as domain filter: ${searchTerm}`);
            }
            // If search term looks like a team name, filter by teams
            else if (searchTerm.includes('team') || searchTerm.includes('department') || searchTerm.includes('group')) {
              apiParams.teams = [searchTerm];
              console.log(`Using search term as team filter: ${searchTerm}`);
            }
            // If search term looks like a person's name (firstname lastname), try to find their email
            else if (searchTerm.includes(' ') && searchTerm.split(' ').length >= 2) {
              console.log(`Search term "${searchTerm}" appears to be a person's name - will search in attendee names`);
              // Don't add to API params, let client-side filtering handle it
            }
            // Otherwise, we'll need to do client-side filtering (unavoidable)
            else {
              console.log(`Search term "${searchTerm}" will be used for client-side filtering`);
            }
          }

          // Handle multiple calendar_invitees with separate API calls
          let allMeetings: any[] = [];
          let hasMultipleEmails = false;
          
          // Check if we have specific filters for pagination logic
          const hasSpecificFilters = apiParams.calendar_invitees || apiParams.calendar_invitees_domains || apiParams.recorded_by;
          
          if (args.calendar_invitees && args.calendar_invitees.length > 0) {
            // Filter out invalid entries (names instead of emails)
            const validEmails = args.calendar_invitees.filter((email: string) => 
              email.includes('@') && email.includes('.')
            );
            const invalidEntries = args.calendar_invitees.filter((email: string) => 
              !email.includes('@') || !email.includes('.')
            );
            
            if (invalidEntries.length > 0) {
              console.log(`⚠️  Ignoring invalid calendar_invitees (not emails): ${invalidEntries.join(', ')}`);
              console.log(`💡 These will be searched in attendee names instead`);
            }
            
            if (validEmails.length > 0) {
              // Merge with any emails from search_term
              const allEmails = apiParams.calendar_invitees ? 
                [...new Set([...apiParams.calendar_invitees, ...validEmails])] : 
                validEmails;
              
              if (allEmails.length > 1) {
                hasMultipleEmails = true;
                console.log(`🔄 Multiple emails detected (${allEmails.length}) - making separate API calls for each email to get ALL meetings`);
                
                // Make separate API calls for each email
                for (const email of allEmails) {
                  console.log(`📧 Fetching meetings for: ${email}`);
                  const emailApiParams = { ...apiParams, calendar_invitees: [email] };
                  
                  let emailMeetings: any[] = [];
                  if (hasSpecificFilters) {
                    // Use pagination for this specific email
                    let cursor: string | undefined = undefined;
                    let totalFetched = 0;
                    const maxFetchLimit = 1000;
                    
                    do {
                      const response = await fathomClient.listMeetings({
                        ...emailApiParams,
                        cursor: cursor
                      });
                      emailMeetings = emailMeetings.concat(response.items);
                      totalFetched += response.items.length;
                      cursor = response.next_cursor;
                      console.log(`📧 Fetched ${response.items.length} meetings for ${email} (total: ${totalFetched})`);
                    } while (cursor && totalFetched < maxFetchLimit);
                  } else {
                    const response = await fathomClient.listMeetings(emailApiParams);
                    emailMeetings = response.items;
                    console.log(`📧 Fetched ${emailMeetings.length} meetings for ${email}`);
                  }
                  
                  allMeetings = allMeetings.concat(emailMeetings);
                }
                
                // Remove duplicates based on meeting ID
                const uniqueMeetings = allMeetings.filter((meeting, index, self) => 
                  index === self.findIndex(m => m.id === meeting.id)
                );
                allMeetings = uniqueMeetings;
                console.log(`🔄 Combined ${allMeetings.length} unique meetings from ${allEmails.length} separate API calls`);
              } else {
                // Single email - use normal flow
                apiParams.calendar_invitees = allEmails;
                console.log(`Using explicit email filter: ${allEmails[0]}`);
              }
            }
          }
          if (args.calendar_invitees_domains) apiParams.calendar_invitees_domains = args.calendar_invitees_domains;
          if (args.recorded_by) apiParams.recorded_by = args.recorded_by;

          console.log('API params:', JSON.stringify(apiParams, null, 2));

          // Get meetings from API using native filtering
          // If we have specific filters (email, domain, etc.), fetch ALL results with pagination
          
          // Skip main API call if we already have meetings from multiple email calls
          if (!hasMultipleEmails) {
            if (hasSpecificFilters) {
              // Fetch ALL meetings with pagination when we have specific filters
              let cursor: string | undefined = undefined;
              let totalFetched = 0;
              const maxFetchLimit = 1000; // Reasonable upper limit
              
              console.log(`🔍 Specific filters detected - fetching ALL matching meetings with pagination`);
              
              do {
                const currentParams = { ...apiParams, cursor };
                const response = await fathomClient.listMeetings(currentParams);
                allMeetings = allMeetings.concat(response.items);
                totalFetched += response.items.length;
                cursor = response.next_cursor;
                
                console.log(`Fetched ${response.items.length} meetings (total: ${totalFetched}), next_cursor: ${cursor}`);
                
                // Stop if we've reached a reasonable limit
                if (totalFetched >= maxFetchLimit) {
                  console.log(`Reached maximum fetch limit of ${maxFetchLimit} meetings`);
                  break;
                }
              } while (cursor && totalFetched < maxFetchLimit);
              
              console.log(`Got ${allMeetings.length} total meetings from API using pagination`);
            } else {
              // Single API call for general searches
      const response = await fathomClient.listMeetings(apiParams);
              allMeetings = response.items;
              console.log(`Got ${allMeetings.length} meetings from API using native filters`);
            }
          } else {
            console.log(`✅ Using meetings from separate email API calls (${allMeetings.length} total)`);
          }
          
          // Debug: If we're filtering by calendar_invitees and got 0 results, let's see what emails are actually in the data
          if (apiParams.calendar_invitees && allMeetings.length === 0) {
            console.log(`🔍 DEBUG: No meetings found with calendar_invitees filter. Let's check what emails exist in recent meetings...`);
            
            // Fetch some recent meetings without the calendar_invitees filter to see what emails are actually there
            const debugParams = { ...apiParams };
            delete debugParams.calendar_invitees;
            debugParams.limit = 10;
            
            const debugResponse = await fathomClient.listMeetings(debugParams);
            console.log(`🔍 DEBUG: Found ${debugResponse.items.length} recent meetings without email filter`);
            
            // Show all unique emails from these meetings
            const allEmails = new Set<string>();
            debugResponse.items.forEach(meeting => {
              meeting.calendar_invitees?.forEach((attendee: any) => {
                if (attendee.email) {
                  allEmails.add(attendee.email);
                }
              });
            });
            
            console.log(`🔍 DEBUG: Unique emails found in recent meetings:`, Array.from(allEmails).slice(0, 20));
          }

          // HARDCODED SECURITY FILTERING - Always exclude sensitive teams/calls
          const hardcodedExcludeTeams = ["Executive", "Personal", "No Team", null, undefined];
          const userExcludeTeams = args.exclude_teams || [];
          const allExcludeTeams = [...new Set([...hardcodedExcludeTeams, ...userExcludeTeams])];
          
          console.log(`HARDCODED exclusions: Executive, Personal, No Team, null/undefined`);
          console.log(`User exclusions: ${userExcludeTeams.join(', ') || 'none'}`);
          console.log(`Total exclusions: ${allExcludeTeams.filter(t => t).join(', ')}`);
          
          let filteredMeetings = allMeetings.filter(meeting => {
            const recordedByTeam = meeting.recorded_by?.team;
            
            // Check if team should be excluded (case-insensitive)
            const isExcluded = allExcludeTeams.some((team: string | null | undefined) => {
              if (team === null || team === undefined) {
                // Exclude meetings with null/undefined teams (private calls)
                return recordedByTeam === null || recordedByTeam === undefined || recordedByTeam === '';
              }
              return recordedByTeam?.toLowerCase().includes(team.toLowerCase());
            });
            
            // Debug logging for team filtering
            if (isExcluded) {
              console.log(`🔒 SECURITY: Excluding sensitive meeting "${meeting.title || meeting.meeting_title}" - team: "${recordedByTeam}"`);
            }
            
            return !isExcluded;
          });
          
          const excludedCount = allMeetings.length - filteredMeetings.length;
          console.log(`🔒 SECURITY: After filtering: ${filteredMeetings.length} meetings (excluded ${excludedCount} sensitive meetings)`);

          // Search within the filtered meetings
          const searchLower = args.search_term.toLowerCase();
          console.log(`Searching for "${searchLower}" in ${filteredMeetings.length} meetings`);
          
          const matchingMeetings = filteredMeetings.filter(meeting => {
            const titleMatch = meeting.title?.toLowerCase().includes(searchLower) ||
                              meeting.meeting_title?.toLowerCase().includes(searchLower);
            const summaryMatch = meeting.default_summary?.markdown_formatted?.toLowerCase().includes(searchLower);
            const actionItemsMatch = meeting.action_items?.some((item: any) => 
              item.description?.toLowerCase().includes(searchLower)
            );
            const attendeeMatch = meeting.calendar_invitees?.some((attendee: any) =>
              attendee.name?.toLowerCase().includes(searchLower) ||
              attendee.email?.toLowerCase().includes(searchLower)
            );

            // Search in transcript if available
            const transcriptMatch = meeting.transcript?.some((entry: any) =>
              entry.text?.toLowerCase().includes(searchLower)
            );

            const isMatch = titleMatch || summaryMatch || actionItemsMatch || attendeeMatch || transcriptMatch;
            
            // Debug logging for matches
            if (isMatch) {
              console.log(`Found match: "${meeting.title || meeting.meeting_title}" - title:${titleMatch}, summary:${summaryMatch}, actionItems:${actionItemsMatch}, attendee:${attendeeMatch}, transcript:${transcriptMatch}`);
            }

            return isMatch;
          });

          console.log(`Found ${matchingMeetings.length} matching meetings out of ${filteredMeetings.length} total meetings`);

          // Apply limit - handle "last X" requests specially
          let finalMeetings;
          let actualLimit;
          
          if (isLastRequest && requestedLastCount) {
            // For "last X" requests, take the last X meetings (most recent)
            finalMeetings = matchingMeetings.slice(-requestedLastCount);
            actualLimit = requestedLastCount;
            console.log(`🔄 Returning last ${requestedLastCount} meetings out of ${matchingMeetings.length} found`);
          } else {
            // Normal limit application
            const limit = Math.min(args.limit || 50, 100);
            finalMeetings = matchingMeetings.slice(0, limit);
            actualLimit = limit;
          }

          const formattedMeetings = finalMeetings.map(meeting => ({
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
                  showing: finalMeetings.length,
                  has_more: matchingMeetings.length > actualLimit,
                  filters_applied: {
                    exclude_teams: allExcludeTeams.filter(t => t),
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

// Note: We're using HTTP-based MCP protocol, so no MCP server handlers needed

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