# MCP Fathom Server

A Model Context Protocol (MCP) server for Fathom AI meeting API integration with HTTP/SSE transport and bearer token authentication.

## Features

- **HTTP/SSE Transport**: Accessible via HTTPS with Server-Sent Events
- **Bearer Token Authentication**: Secure access with custom bearer tokens
- **Fathom AI Integration**: List and search meetings from your Fathom account
- **Render.com Ready**: Optimized for deployment on Render.com

## Environment Variables

The server requires the following environment variables:

- `FATHOM_API_KEY`: Your Fathom AI API key
- `MCP_BEARER_TOKEN`: Custom bearer token for authentication
- `PORT`: Server port (optional, defaults to 3000)

## Render.com Deployment

### 1. Create a New Web Service

1. Go to your [Render Dashboard](https://dashboard.render.com)
2. Click "New +" → "Web Service"
3. Connect your GitHub repository

### 2. Configure Build Settings

- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`
- **Environment**: `Node`

### 3. Set Environment Variables

In your Render service settings, add these environment variables:

```
FATHOM_API_KEY=your_fathom_api_key_here
MCP_BEARER_TOKEN=your_secure_bearer_token_here
MCP_TIMEOUT=300000
```

### 4. Deploy

Click "Create Web Service" and wait for deployment to complete.

Your MCP server will be available at: `https://your-app-name.onrender.com/sse`

## Client Configuration

Configure your MCP client to connect to the server:

```json
{
  "mcpServers": {
    "fathom": {
      "url": "https://your-app-name.onrender.com/sse",
      "headers": {
        "Authorization": "Bearer your_secure_bearer_token_here"
      }
    }
  }
}
```

## Available Tools

### search_meetings

Comprehensive search for Fathom meetings with advanced filtering and rich data retrieval. Can search by keywords in titles, summaries, action items, or attendees. Automatically excludes Executive and Personal teams.

**Parameters:**
- `search_term` (required): Search term to find in meeting titles, summaries, action items, or attendee names
- `limit` (optional): Maximum number of meetings to return (default: 50, max: 100)
- `days_back` (optional): Number of days to look back from today (default: 180, max: 365)
- `created_after` (optional): Filter meetings created after this date (ISO 8601 format). Overrides days_back if provided.
- `created_before` (optional): Filter meetings created before this date (ISO 8601 format)
- `exclude_teams` (optional): Teams to exclude from results (default: ['Executive', 'Personal'])
- `include_transcript` (optional): Whether to include full transcripts (default: false, WARNING: Can be very large and slow)
- `include_summary` (optional): Whether to include meeting summaries (default: true)
- `include_action_items` (optional): Whether to include action items (default: true)
- `calendar_invitees` (optional): Filter by attendee email addresses
- `calendar_invitees_domains` (optional): Filter by company domains
- `recorded_by` (optional): Filter by meeting owner email addresses

**Features:**
- ✅ **Comprehensive search** across titles, summaries, action items, attendees, and transcripts
- ✅ **Rich data retrieval** with summaries and action items included by default
- ✅ **Smart team filtering** automatically excludes Executive and Personal meetings
- ✅ **Flexible date filtering** with days back or specific date ranges
- ✅ **High API limits** (up to 100 meetings) for better search coverage

## API Endpoints

- `GET /sse` - MCP Server-Sent Events endpoint (requires bearer token)
- `GET /health` - Health check endpoint (no authentication required)

## Security

- All MCP endpoints require bearer token authentication
- Use a strong, unique bearer token for production
- The health check endpoint is public for monitoring purposes

## Development

### Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set environment variables:
   ```bash
   export FATHOM_API_KEY=your_fathom_api_key
   export MCP_BEARER_TOKEN=your_bearer_token
   ```

3. Build and run:
   ```bash
   npm run build
   npm start
   ```

4. Test the connection:
   ```bash
   curl -H "Authorization: Bearer your_bearer_token" http://localhost:3000/health
   ```

### Testing with MCP Inspector

```bash
npm run test
```

## License

MIT