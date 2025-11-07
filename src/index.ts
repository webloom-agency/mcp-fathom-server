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
                    description: "Filter by attendee email addresses (NOTE: Filtered client-side after Nov 13, 2024 due to API deprecation. For better performance, use calendar_invitees_domains when possible.)"
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
          // NOTE: calendar_invitees API parameter is deprecated by Fathom (disabled after Nov 13, 2024)
          // We now use client-side filtering for emails and calendar_invitees_domains for API filtering
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

          // Track emails for client-side filtering (calendar_invitees API param is deprecated)
          let emailsToFilter: string[] = [];
          
          // Helper function to extract domain from email
          const extractDomain = (email: string): string | null => {
            const match = email.match(/@([\w.-]+\.[a-z]{2,})/i);
            return match ? match[1] : null;
          };

          // Use search_term as native API filters
          let effectiveSearchTermGlobal: string | undefined = undefined;
          if (args.search_term) {
            const searchTerm = args.search_term.toLowerCase();
            let effectiveSearchTerm = searchTerm;
            let identityFiltersApplied = false;

            // Heuristic 1: extract any email(s) present anywhere in the text
            const emailRegex = /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi;
            const foundEmails: string[] = Array.from(new Set<string>(searchTerm.match(emailRegex) || []));

            // Heuristic 2: extract any domain(s) present anywhere in the text (e.g., legalstart.fr)
            const domainRegex = /\b([a-z0-9-]+\.[a-z]{2,})(?:\b|\s|\)|\]|"|')/gi;
            const foundDomains: string[] = Array.from(new Set<string>((searchTerm.match(domainRegex) || []).map((d: string) => d.trim().replace(/[)\]"']$/, ''))));

            // Prefer explicit @agent first
            if (agentEmail) {
              if (agentEmail.includes('@')) {
                // Track email for client-side filtering (API param deprecated)
                emailsToFilter.push(agentEmail);
                // Try to use domain filter for better API performance
                const domain = extractDomain(agentEmail);
                if (domain) {
                  if (!apiParams.calendar_invitees_domains) apiParams.calendar_invitees_domains = [];
                  apiParams.calendar_invitees_domains.push(domain);
                  console.log(`🤖 Using agent email ${agentEmail} - will filter by domain ${domain} (API) and email (client-side)`);
                } else {
                  console.log(`🤖 Using agent email ${agentEmail} - will filter client-side (no domain available)`);
                }
                effectiveSearchTerm = effectiveSearchTerm.replace(new RegExp(agentEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
                identityFiltersApplied = true;
              } else {
                apiParams.calendar_invitees_domains = [agentEmail];
                console.log(`🤖 Using agent name as domain filter: ${agentEmail}`);
                effectiveSearchTerm = effectiveSearchTerm.replace(new RegExp(agentEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
                identityFiltersApplied = true;
              }
            } else if (foundEmails.length > 0) {
              // Track emails for client-side filtering
              emailsToFilter.push(...foundEmails);
              // Extract domains and use domain filter for better API performance
              const domains = foundEmails.map(extractDomain).filter((d): d is string => d !== null);
              if (domains.length > 0) {
                if (!apiParams.calendar_invitees_domains) apiParams.calendar_invitees_domains = [];
                apiParams.calendar_invitees_domains.push(...domains);
                console.log(`📧 Detected email(s) in query: ${foundEmails.join(', ')} - using domain filter: ${domains.join(', ')} (API) and email filter (client-side)`);
              } else {
                console.log(`📧 Detected email(s) in query: ${foundEmails.join(', ')} - will filter client-side only`);
              }
              foundEmails.forEach(email => {
                effectiveSearchTerm = effectiveSearchTerm.replace(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
              });
              identityFiltersApplied = true;
            } else if (foundDomains.length > 0) {
              // If any domains were found in free text, use them
              apiParams.calendar_invitees_domains = foundDomains;
              console.log(`🌐 Detected domain(s) in query, filtering by domains:`, foundDomains);
              foundDomains.forEach(domain => {
                effectiveSearchTerm = effectiveSearchTerm.replace(new RegExp(domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
              });
              identityFiltersApplied = true;
            }
            // If search term looks like an email address (contains @), filter by email
            else if (searchTerm.includes('@')) {
              emailsToFilter.push(searchTerm);
              const domain = extractDomain(searchTerm);
              if (domain) {
                if (!apiParams.calendar_invitees_domains) apiParams.calendar_invitees_domains = [];
                apiParams.calendar_invitees_domains.push(domain);
                console.log(`Using search term as email filter: ${searchTerm} - using domain ${domain} (API) and email (client-side)`);
              } else {
                console.log(`Using search term as email filter: ${searchTerm} - will filter client-side`);
              }
              effectiveSearchTerm = effectiveSearchTerm.replace(new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
              identityFiltersApplied = true;
            }
            // If search term looks like a domain (contains . but no @ and no spaces), filter by domain
            else if (searchTerm.includes('.') && !searchTerm.includes('@') && !searchTerm.includes(' ')) {
              apiParams.calendar_invitees_domains = [searchTerm];
              console.log(`Using search term as domain filter: ${searchTerm}`);
              effectiveSearchTerm = effectiveSearchTerm.replace(new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
              identityFiltersApplied = true;
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

            // Normalize remaining free-text portion and expose it to later filtering
            effectiveSearchTerm = effectiveSearchTerm.replace(/\s+/g, ' ').trim();
            effectiveSearchTermGlobal = effectiveSearchTerm.length > 0 ? effectiveSearchTerm : undefined;
          }

          // Handle explicit calendar_invitees parameter (NOTE: API param deprecated, will filter client-side)
          let allMeetings: any[] = [];
          
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
              emailsToFilter = [...new Set([...emailsToFilter, ...validEmails])];
              
              // Extract domains from emails for API filtering (better performance)
              const domains = validEmails.map(extractDomain).filter((d: string | null): d is string => d !== null);
              if (domains.length > 0) {
                if (!apiParams.calendar_invitees_domains) apiParams.calendar_invitees_domains = [];
                apiParams.calendar_invitees_domains.push(...domains);
                console.log(`📧 Using explicit calendar_invitees: ${validEmails.join(', ')} - will filter by domains ${domains.join(', ')} (API) and emails (client-side)`);
              } else {
                console.log(`📧 Using explicit calendar_invitees: ${validEmails.join(', ')} - will filter client-side only`);
              }
            }
          }
          
          // Deduplicate domains
          if (apiParams.calendar_invitees_domains) {
            apiParams.calendar_invitees_domains = [...new Set(apiParams.calendar_invitees_domains)];
          }
          
          if (args.calendar_invitees_domains) {
            if (!apiParams.calendar_invitees_domains) apiParams.calendar_invitees_domains = [];
            apiParams.calendar_invitees_domains.push(...args.calendar_invitees_domains);
            apiParams.calendar_invitees_domains = [...new Set(apiParams.calendar_invitees_domains)];
          }
          if (args.recorded_by) apiParams.recorded_by = args.recorded_by;
          
          // Check if we have specific filters for pagination logic
          const hasSpecificFilters = apiParams.calendar_invitees_domains || apiParams.recorded_by;

          console.log('API params:', JSON.stringify(apiParams, null, 2));
          if (emailsToFilter.length > 0) {
            console.log(`📧 Emails to filter client-side: ${emailsToFilter.join(', ')}`);
          }

          // Get meetings from API using native filtering
          // NOTE: calendar_invitees is no longer sent to API (deprecated), will filter client-side instead
          // If we have specific filters (domain, recorded_by, etc.), fetch ALL results with pagination
          
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
          
          // Apply client-side filtering by email addresses (calendar_invitees API param is deprecated)
          if (emailsToFilter.length > 0) {
            const beforeFilterCount = allMeetings.length;
            const emailsToFilterLower = emailsToFilter.map(e => e.toLowerCase());
            allMeetings = allMeetings.filter(meeting => {
              // Check if any attendee email matches
              return meeting.calendar_invitees?.some((attendee: any) => {
                const attendeeEmail = attendee.email?.toLowerCase();
                return attendeeEmail && emailsToFilterLower.includes(attendeeEmail);
              }) || false;
            });
            console.log(`📧 Client-side email filtering: ${beforeFilterCount} → ${allMeetings.length} meetings (filtered by: ${emailsToFilter.join(', ')})`);
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

          // Search within the filtered meetings (only if we have a search term)
          const searchLower = args.search_term?.toLowerCase() || '';
          let matchingMeetings = filteredMeetings;
          
          // Use the stripped free-text (if available) to avoid double-filtering by identity tokens
          const freeText = effectiveSearchTermGlobal || searchLower;
          if (freeText) {
            console.log(`Searching for "${freeText}" in ${filteredMeetings.length} meetings`);
            
            matchingMeetings = filteredMeetings.filter(meeting => {
            const titleMatch = meeting.title?.toLowerCase().includes(freeText) ||
                              meeting.meeting_title?.toLowerCase().includes(freeText);
            const summaryMatch = meeting.default_summary?.markdown_formatted?.toLowerCase().includes(freeText);
            const actionItemsMatch = meeting.action_items?.some((item: any) => 
              item.description?.toLowerCase().includes(freeText)
            );
            const attendeeMatch = meeting.calendar_invitees?.some((attendee: any) =>
              attendee.name?.toLowerCase().includes(freeText) ||
              attendee.email?.toLowerCase().includes(freeText)
            );

            // Search in transcript if available
            const transcriptMatch = meeting.transcript?.some((entry: any) =>
              entry.text?.toLowerCase().includes(freeText)
            );

            const isMatch = titleMatch || summaryMatch || actionItemsMatch || attendeeMatch || transcriptMatch;
            
            // Debug logging for matches
            if (isMatch) {
              console.log(`Found match: "${meeting.title || meeting.meeting_title}" - title:${titleMatch}, summary:${summaryMatch}, actionItems:${actionItemsMatch}, attendee:${attendeeMatch}, transcript:${transcriptMatch}`);
            }

            return isMatch;
          });
          } else {
            console.log(`No search term provided - returning all ${filteredMeetings.length} filtered meetings`);
          }

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