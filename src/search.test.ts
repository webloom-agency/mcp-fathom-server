import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  meetingMatchesQuery,
  parseSearchQuery,
  foldAccents,
  isSensitiveTeam,
  DEFAULT_EXCLUDE_TEAMS,
} from "./search.js";

const arkemaMeeting = {
  title: "webbloom & cecile.dourthe@arkema.com",
  meeting_title: "webbloom & cecile.dourthe@arkema.com",
  default_summary: {
    markdown_formatted:
      "## Contexte : les défis digitaux d'Arkema\nCécile Dourthe, responsable Web Analytics…",
  },
  action_items: [
    { description: "Send Cécile proposals: GEO/LLM audit + run" },
  ],
  calendar_invitees: [
    {
      name: "DOURTHE Cecile",
      email: "cecile.dourthe@arkema.com",
      email_domain: "arkema.com",
    },
    {
      name: "François Dragon",
      email: "francois@webloom.fr",
      email_domain: "webloom.fr",
    },
  ],
  recorded_by: {
    name: "François Dragon",
    email: "francois@webloom.fr",
    team: "Customer Success",
  },
};

describe("foldAccents", () => {
  it("strips accents", () => {
    assert.equal(foldAccents("Cécile"), "cecile");
  });
});

describe("parseSearchQuery", () => {
  it("parses company name", () => {
    const q = parseSearchQuery("Arkema");
    assert.deepEqual(q.keywords, ["arkema"]);
    assert.deepEqual(q.domains, []);
  });

  it("parses domain and keeps company label keyword", () => {
    const q = parseSearchQuery("arkema.com");
    assert.ok(q.domains.includes("arkema.com"));
    assert.ok(q.keywords.includes("arkema"));
  });

  it("parses email into email + domain", () => {
    const q = parseSearchQuery("cecile.dourthe@arkema.com");
    assert.deepEqual(q.emails, ["cecile.dourthe@arkema.com"]);
    assert.ok(q.domains.includes("arkema.com"));
  });

  it("tokenizes accented multi-word queries", () => {
    const q = parseSearchQuery("Cécile Dourthe Arkema");
    assert.deepEqual(q.keywords, ["cecile", "dourthe", "arkema"]);
  });
});

describe("meetingMatchesQuery — Arkema call", () => {
  it("matches search_term Arkema", () => {
    assert.equal(meetingMatchesQuery(arkemaMeeting, parseSearchQuery("Arkema")), true);
  });

  it("matches search_term arkema.com", () => {
    assert.equal(meetingMatchesQuery(arkemaMeeting, parseSearchQuery("arkema.com")), true);
  });

  it("matches email in calendar_invitees", () => {
    const emailOnly = parseSearchQuery("cecile.dourthe@arkema.com");
    assert.equal(meetingMatchesQuery(arkemaMeeting, emailOnly), true);

    const explicit = parseSearchQuery("Arkema", ["cecile.dourthe@arkema.com"]);
    assert.equal(meetingMatchesQuery(arkemaMeeting, explicit), true);
  });

  it("matches Cécile Dourthe Arkema despite accents and name order", () => {
    assert.equal(
      meetingMatchesQuery(arkemaMeeting, parseSearchQuery("Cécile Dourthe Arkema")),
      true
    );
  });

  it("does not match unrelated company", () => {
    assert.equal(meetingMatchesQuery(arkemaMeeting, parseSearchQuery("TotallyUnrelatedCo")), false);
  });

  it("matches domain even if invitee list empty but title has email", () => {
    const titleOnly = {
      title: "webbloom & cecile.dourthe@arkema.com",
      calendar_invitees: [],
    };
    assert.equal(meetingMatchesQuery(titleOnly, parseSearchQuery("arkema.com")), true);
    assert.equal(meetingMatchesQuery(titleOnly, parseSearchQuery("Arkema")), true);
  });
});

describe("isSensitiveTeam", () => {
  it("excludes Executive/Personal by default, keeps null team", () => {
    assert.equal(isSensitiveTeam("Executive", DEFAULT_EXCLUDE_TEAMS), true);
    assert.equal(isSensitiveTeam("Personal", DEFAULT_EXCLUDE_TEAMS), true);
    assert.equal(isSensitiveTeam("Customer Success", DEFAULT_EXCLUDE_TEAMS), false);
    assert.equal(isSensitiveTeam(null, DEFAULT_EXCLUDE_TEAMS), false);
    assert.equal(isSensitiveTeam(null, [...DEFAULT_EXCLUDE_TEAMS, null]), true);
  });
});
