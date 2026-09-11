import axios, { AxiosInstance, AxiosError } from "axios";
import {
  FathomListMeetingsParams,
  FathomListMeetingsResponse,
  FathomMeeting,
} from "./types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FathomClient {
  private client: AxiosInstance;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("Fathom API key is required");
    }

    this.client = axios.create({
      baseURL: "https://api.fathom.ai/external/v1",
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
      },
      timeout: 60000,
      paramsSerializer: {
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

  /** GET with Retry-After handling for Fathom 429s (global 60/min, heavy 30/min). */
  private async requestWithRetry<T>(
    doRequest: () => Promise<{ data: T; headers: Record<string, unknown> }>,
    maxRetries = 4
  ): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        const response = await doRequest();
        return response.data;
      } catch (error) {
        if (!(error instanceof AxiosError) || error.response?.status !== 429 || attempt >= maxRetries) {
          throw this.handleError(error);
        }

        const retryAfterRaw = error.response.headers?.["retry-after"];
        const retryAfterSec = retryAfterRaw ? Number(retryAfterRaw) : NaN;
        const waitMs = Number.isFinite(retryAfterSec)
          ? Math.max(retryAfterSec, 1) * 1000
          : Math.min(15000, 2000 * Math.pow(2, attempt));

        console.warn(`Fathom 429 — waiting ${waitMs}ms before retry ${attempt + 1}/${maxRetries}`);
        await sleep(waitMs);
        attempt += 1;
      }
    }
  }

  async listMeetings(
    params?: FathomListMeetingsParams & { cursor?: string; limit?: number }
  ): Promise<FathomListMeetingsResponse> {
    return this.requestWithRetry(() =>
      this.client.get<FathomListMeetingsResponse>("/meetings", {
        params: this.formatParams(params),
      })
    );
  }

  async getSummary(recordingId: number): Promise<FathomMeeting["default_summary"] | null> {
    const data = await this.requestWithRetry<{
      summary?: FathomMeeting["default_summary"];
    }>(() => this.client.get(`/recordings/${recordingId}/summary`));
    return data.summary ?? null;
  }

  async getTranscript(recordingId: number): Promise<FathomMeeting["transcript"] | null> {
    const data = await this.requestWithRetry<{
      transcript?: FathomMeeting["transcript"];
    }>(() => this.client.get(`/recordings/${recordingId}/transcript`));
    return data.transcript ?? null;
  }

  private formatParams(
    params?: FathomListMeetingsParams & { cursor?: string; limit?: number }
  ): Record<string, any> {
    if (!params) return {};

    const formatted: Record<string, any> = {};

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
        const retryAfter = error.response.headers?.["retry-after"];
        return new Error(
          retryAfter
            ? `Rate limit exceeded. Retry after ${retryAfter}s.`
            : "Rate limit exceeded. Please try again later."
        );
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
