import axios, { AxiosInstance, AxiosError } from "axios";
import { FathomListMeetingsParams, FathomListMeetingsResponse } from "./types.js";

export class FathomClient {
  private client: AxiosInstance;
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("Fathom API key is required");
    }

    this.apiKey = apiKey;
    this.client = axios.create({
      baseURL: "https://api.fathom.ai/external/v1",
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
      },
      timeout: 60000,
      paramsSerializer: {
        // Fathom expects repeated keys: recorded_by[]=a&recorded_by[]=b
        serialize: (params) => {
          const parts: string[] = [];
          for (const [key, value] of Object.entries(params)) {
            if (value === undefined || value === null) continue;
            if (Array.isArray(value)) {
              for (const item of value) {
                parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
              }
            } else if (typeof value === "boolean") {
              parts.push(`${encodeURIComponent(key)}=${value ? "true" : "false"}`);
            } else {
              parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
            }
          }
          return parts.join("&");
        },
      },
    });
  }

  async listMeetings(params?: FathomListMeetingsParams & { cursor?: string; limit?: number }): Promise<FathomListMeetingsResponse> {
    try {
      const response = await this.client.get<FathomListMeetingsResponse>("/meetings", {
        params: this.formatParams(params),
      });
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private formatParams(params?: FathomListMeetingsParams & { cursor?: string; limit?: number }): Record<string, any> {
    if (!params) return {};

    const formatted: Record<string, any> = {};

    // calendar_invitees is deprecated by Fathom (disabled after Nov 13, 2024) — never send it.
    // calendar_invitees_domains filters by *associated company*, not invitee domains — only send
    // when the caller explicitly opts into that (we no longer do so from search_meetings).
    if (params.calendar_invitees_domains?.length) {
      formatted["calendar_invitees_domains[]"] = params.calendar_invitees_domains;
    }
    if (params.recorded_by?.length) {
      formatted["recorded_by[]"] = params.recorded_by;
    }
    if (params.teams?.length) {
      formatted["teams[]"] = params.teams;
    }

    for (const [key, value] of Object.entries(params)) {
      if (
        key === "calendar_invitees" ||
        key === "calendar_invitees_domains" ||
        key === "recorded_by" ||
        key === "teams" ||
        value === undefined
      ) {
        continue;
      }
      formatted[key] = value;
    }

    return formatted;
  }

  private handleError(error: unknown): Error {
    if (error instanceof AxiosError) {
      if (error.response?.status === 429) {
        return new Error("Rate limit exceeded. Please try again later.");
      }
      if (error.response?.status === 401) {
        return new Error("Invalid API key. Please check your Fathom API key.");
      }
      if (error.response?.data?.message) {
        return new Error(`Fathom API error: ${error.response.data.message}`);
      }
    }

    return error instanceof Error ? error : new Error("Unknown error occurred");
  }
}
