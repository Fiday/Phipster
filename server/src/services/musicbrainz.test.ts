import assert from "node:assert/strict";
import test from "node:test";
import { checkReleaseYear } from "./musicbrainz.js";

test("ISRC release-year lookup produces a high-confidence correction and caches it", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    assert.match(String(url), /isrc%3ATESTISRC1300001/);
    const headers = init?.headers as Record<string, string> | undefined;
    assert.match(headers?.["User-Agent"] || "", /phipster\/1\.3\.0/);
    return new Response(JSON.stringify({
      recordings: [{
        id: "test-mbid",
        score: 100,
        title: "Test Song",
        "first-release-date": "1984-04-02",
        "artist-credit": [{ name: "Test Band" }],
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const input = { title: "Test Song", artist: "Test Band", isrc: "TESTISRC1300001", spotifyYear: 2011 };
    const first = await checkReleaseYear(input, { userAgent: "phipster/1.3.0 ( https://bibster.tallgin.com )" });
    assert.equal(first.status, "mismatch");
    assert.equal(first.suggestedYear, 1984);
    assert.equal(first.confidence, "high");

    const second = await checkReleaseYear(input, { userAgent: "phipster/1.3.0 ( https://bibster.tallgin.com )" });
    assert.equal(second.suggestedYear, 1984);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
