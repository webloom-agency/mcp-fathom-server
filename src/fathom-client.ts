import axios, { AxiosInstance, AxiosError } from 'axios';
import { FathomListMeetingsParams, FathomListMeetingsResponse, FathomMeeting } from './types.js';

export class FathomClient {
  private client: AxiosInstance;
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Fathom API key is required');
    }
    
    this.apiKey = apiKey;
    this.client = axios.create({
      baseURL: 'https://api.fathom.ai/external/v1',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
  }

  async listMeetings(params?: FathomListMeetingsParams): Promise<FathomListMeetingsResponse> {
    try {
      const response = await this.client.get<FathomListMeetingsResponse>('/meetings', {
        params: this.formatParams(params)
      });
      
      // Debug: Log the first meeting to see what fields are available
      if (response.data.items.length > 0) {
        const firstMeeting = response.data.items[0];
        console.error('[listMeetings] First meeting fields:', Object.keys(firstMeeting));
        console.error('[listMeetings] First meeting summary:', firstMeeting.default_summary);
        console.error('[listMeetings] First meeting action_items:', firstMeeting.action_items);
        
        // Check for alternative field names (using any to explore unknown fields)
        const meetingAny = firstMeeting as any;
        console.error('[listMeetings] Checking for alternative summary fields:');
        console.error('  - summary:', meetingAny.summary);
        console.error('  - meeting_summary:', meetingAny.meeting_summary);
        console.error('  - ai_summary:', meetingAny.ai_summary);
        console.error('  - notes:', meetingAny.notes);
        
        console.error('[listMeetings] Checking for alternative action item fields:');
        console.error('  - action_items:', firstMeeting.action_items);
        console.error('  - action_items_list:', meetingAny.action_items_list);
        console.error('  - tasks:', meetingAny.tasks);
        console.error('  - todo_items:', meetingAny.todo_items);
      }
      
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async searchMeetings(searchTerm: string, includeTranscript: boolean = false): Promise<FathomMeeting[]> {
    // Search in the last 6 months to find more meetings
    // Use proper API parameters to get summaries and action items
    const response = await this.listMeetings({
      include_transcript: includeTranscript,
      include_summary: true, // This will get the summaries
      include_action_items: true, // This will get the action items
      include_crm_matches: false, // We don't need CRM data for search
      created_after: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString() // Last 180 days (6 months)
    });
    
    const searchLower = searchTerm.toLowerCase();
    console.error(`[searchMeetings] Searching for "${searchTerm}" in ${response.items.length} meetings`);
    
    const filteredMeetings = response.items.filter(meeting => {
      const titleMatch = meeting.title?.toLowerCase().includes(searchLower) ||
                        meeting.meeting_title?.toLowerCase().includes(searchLower);
      const summaryMatch = meeting.default_summary?.markdown_formatted?.toLowerCase().includes(searchLower);
      const actionItemsMatch = meeting.action_items?.some(item =>
        item.description?.toLowerCase().includes(searchLower)
      );
      
      // Debug logging for matches
      if (titleMatch || summaryMatch || actionItemsMatch) {
        console.error(`[searchMeetings] Found match: "${meeting.title || meeting.meeting_title}" - title:${titleMatch}, summary:${summaryMatch}, actionItems:${actionItemsMatch}`);
      }
      
      return titleMatch || summaryMatch || actionItemsMatch;
    });
    
    console.error(`[searchMeetings] Found ${filteredMeetings.length} matching meetings`);
    
    // If we need transcripts, fetch them individually for just the matching meetings
    if (includeTranscript && filteredMeetings.length > 0 && filteredMeetings.length <= 5) {
      // Only fetch transcripts for up to 5 meetings to avoid timeouts
      console.error(`Fetching transcripts for ${filteredMeetings.length} meetings...`);
      // Note: This would require individual meeting fetch API which Fathom doesn't seem to provide
      // So we'll return without transcripts for now
    }
    
    return filteredMeetings;
  }

  private formatParams(params?: FathomListMeetingsParams): Record<string, any> {
    if (!params) return {};
    
    const formatted: Record<string, any> = {};
    
    if (params.calendar_invitees?.length) {
      formatted['calendar_invitees[]'] = params.calendar_invitees;
    }
    if (params.calendar_invitees_domains?.length) {
      formatted['calendar_invitees_domains[]'] = params.calendar_invitees_domains;
    }
    if (params.recorded_by?.length) {
      formatted['recorded_by[]'] = params.recorded_by;
    }
    if (params.teams?.length) {
      formatted['teams[]'] = params.teams;
    }
    
    Object.entries(params).forEach(([key, value]) => {
      if (!key.includes('calendar_invitees') && !key.includes('recorded_by') && !key.includes('teams') && value !== undefined) {
        formatted[key] = value;
      }
    });
    
    return formatted;
  }

  private handleError(error: unknown): Error {
    if (error instanceof AxiosError) {
      if (error.response?.status === 429) {
        return new Error('Rate limit exceeded. Please try again later.');
      }
      if (error.response?.status === 401) {
        return new Error('Invalid API key. Please check your Fathom API key.');
      }
      if (error.response?.data?.message) {
        return new Error(`Fathom API error: ${error.response.data.message}`);
      }
    }
    
    return error instanceof Error ? error : new Error('Unknown error occurred');
  }
}