# Realism-rater brief

`DRIFT.md` describes a change in a vendor HTTP API's responses, and `drift/transform.ts` is the
response rewriter that reproduces it. The vendor's public docs are in `docs/`.

Rate how realistic it is that a real vendor would ship this change, on a scale from one to five:

- 1: implausible; no real vendor would do this.
- 2: unlikely; it would need an unusual mistake.
- 3: plausible; it resembles changes that happen.
- 4: likely; changes like this happen regularly.
- 5: typical; a well-known class of real API change.

Return the structured result `{ "score": <integer>, "rationale": "<two or three sentences>" }`.
