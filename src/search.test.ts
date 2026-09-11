import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  meetingMatchesQuery,
  parseSearchQuery,
  foldAccents,
  shouldExcludeMeeting,
} from "./search.js";

const arkemaAllTeams = {
  title: "webbloom & cecile.dourthe@arkema.com",
  shared_with: "all_teams",
  calendar_invitees: [
    { name: "DOURTHE Cecile", email: "cecile.dourthe@arkema.com", email_domain: "arkema.com" },
  ],
  recorded_by: { name: "François", email: "francois@webloom.fr", team: "Executive" },
};

describe("foldAccents", () => {
  it("strips accents", () => {
    assert.equal(foldAccents("Cécile"), "cecile");
  });
});

describe("meetingMatchesQuery", () => {
  it("matches arkema", () => {
    assert.equal(meetingMatchesQuery(arkemaAllTeams, parseSearchQuery("arkema")), true);
  });
});

describe("shouldExcludeMeeting", () => {
  it("Executive + All Teams → included", () => {
    assert.equal(shouldExcludeMeeting(arkemaAllTeams, [], false), false);
  });

  it("Executive + No Team / Executive Only → hidden", () => {
    assert.equal(
      shouldExcludeMeeting({ shared_with: "no_teams", recorded_by: { team: "Executive" } }, [], false),
      true
    );
    assert.equal(
      shouldExcludeMeeting(
        { shared_with: "single_team", recorded_by: { team: "Executive" } },
        [],
        false
      ),
      true
    );
  });

  it("No Team Visibility hides any host (voluntary hide)", () => {
    assert.equal(
      shouldExcludeMeeting(
        { shared_with: "no_teams", recorded_by: { team: "Customer Success" } },
        [],
        false
      ),
      true
    );
  });

  it("No Team Visibility included only with includePrivate", () => {
    assert.equal(
      shouldExcludeMeeting(
        { shared_with: "no_teams", recorded_by: { team: "Customer Success" } },
        [],
        true
      ),
      false
    );
  });

  it("Customer Success + team/all visibility → included", () => {
    for (const shared of ["single_team", "multiple_teams", "all_teams"]) {
      assert.equal(
        shouldExcludeMeeting(
          { shared_with: shared, recorded_by: { team: "Customer Success" } },
          [],
          false
        ),
        false,
        shared
      );
    }
  });
});
