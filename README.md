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

### list_meetings

List Fathom meetings with optional filters.

**Parameters:**
- `calendar_invitees` (optional): Filter by attendee email addresses
- `calendar_invitees_domains` (optional): Filter by company domains
- `created_after` (optional): Filter meetings created after this date (ISO 8601)
- `created_before` (optional): Filter meetings created before this date (ISO 8601)
- `include_transcript` (optional): Include meeting transcripts (default: false)
- `meeting_type` (optional): Filter by meeting type ('all', 'internal', 'external')
- `recorded_by` (optional): Filter by meeting owner email addresses
- `teams` (optional): Filter by team names
- `limit` (optional): Maximum number of meetings to return (default: 50)

### search_meetings

Search for meetings containing keywords in titles, summaries, or action items.

**Parameters:**
- `search_term` (required): Search term to find in meeting content
- `include_transcript` (optional): Whether to search within transcripts (default: false)

**Note:** Searches are limited to the last 30 days for performance.

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