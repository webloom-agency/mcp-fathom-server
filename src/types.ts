export interface FathomMeeting {
  title: string;
  meeting_title: string;
  recording_id: number;
  url: string;
  share_url: string;
  created_at: string;
  scheduled_start_time?: string;
  scheduled_end_time?: string;
  recording_start_time?: string;
  recording_end_time?: string;
  calendar_invitees_domains_type?: string;
  transcript_language?: string;
  transcript?: Array<{
    speaker: {
      display_name: string;
      matched_calendar_invitee_email?: string;
    };
    text: string;
    timestamp: string;
  }>;
  default_summary?: {
    template_name: string;
    markdown_formatted: string;
  };
  action_items?: Array<{
    description: string;
    user_generated: boolean;
    completed: boolean;
    recording_timestamp?: string;
    recording_playback_url?: string;
    assignee?: {
      name: string;
      email: string;
      team: string;
    };
  }>;
  calendar_invitees: Array<{
    name: string;
    matched_speaker_display_name?: string;
    email: string;
    email_domain: string;
    is_external: boolean;
  }>;
  recorded_by: {
    name: string;
    email: string;
    email_domain: string;
    team: string;
  };
  crm_matches?: {
    contacts?: Array<{
      name: string;
      email: string;
      record_url: string;
    }>;
    companies?: Array<{
      name: string;
      record_url: string;
    }>;
    deals?: Array<{
      name: string;
      amount: number;
      record_url: string;
    }>;
    error?: string;
  };
}

export interface FathomListMeetingsParams {
  calendar_invitees?: string[];
  calendar_invitees_domains?: string[];
  calendar_invitees_domains_type?: 'all' | 'only_internal' | 'one_or_more_external';
  created_after?: string;
  created_before?: string;
  cursor?: string;
  include_action_items?: boolean;
  include_crm_matches?: boolean;
  include_summary?: boolean;
  include_transcript?: boolean;
  meeting_type?: 'all' | 'internal' | 'external';
  recorded_by?: string[];
  teams?: string[];
}

export interface FathomListMeetingsResponse {
  items: FathomMeeting[];
  limit: number;
  next_cursor?: string;
}