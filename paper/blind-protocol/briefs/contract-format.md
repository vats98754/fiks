## Output format

Write one JSON file, `out/contracts.json`, and a short `out/NOTES.md` that explains each check in
one line. The JSON file has this shape:

```
{ "server": "<server name>", "version": 1, "contracts": [ <tool entry>, ... ] }
```

A tool entry:

```
{ "id": "<domain>.<tool>", "tool": "<tool>",
  "invariants": [ <check>, ... ],
  "postconditions": [ <read-back>, ... ],          (optional, mutating tools only)
  "knownGoodInputs": [ { <args> }, ... ],          (optional)
  "outputSchema": { <JSON Schema> } }              (optional; the tool's declared schema is used otherwise)
```

Paths are dotted, with `[*]` for every element of an array (for example `items[*].name`). Each
check has a unique `id` within its tool entry and one `kind`:

- `range`: `{ "path", "min"?, "max"?, "unit"? }`: every number at `path` lies in the range.
- `notNull`: `{ "path", "onlyKnownGood"? }`: the value at `path` is present and not null.
- `nonEmpty`: `{ "path", "onlyKnownGood"? }`: the array or string at `path` is not empty.
- `countMatchesTotal`: `{ "itemsPath", "totalPath" }`: the number of items equals the reported total.
- `freshness`: `{ "path", "maxAgeDays", "maxFutureDays"? }`: the timestamp is recent relative to now.
- `equalsUpstream`: `{ "path", "upstreamPath", "compare"?: "json" | "instant" }`: the result reports
  what the first upstream JSON response said.
- `unique`: `{ "path" }`: no two values at `path` are equal.
- `enum`: `{ "path", "values": [...], "onlyKnownGood"? }`: every value at `path` is one of `values`.
- `crossField`: `{ "path"?, "left", "op": "==" | "!=" | "<" | "<=" | ">" | ">=", "right", "tolerance"? }`:
  a relation between two fields of the same object.
- `pageComplete`: `{ "upstreamCursorPath" }`: once an upstream response carries this cursor
  field, the last response says there is no further page.

`onlyKnownGood: true` limits a check to the inputs listed in `knownGoodInputs` (inputs that are
known to have real data).

A read-back (for a tool that writes):

```
{ "id": "readAfterWrite", "probeTool": "<tool that reads>",
  "probeArgs": { "<arg>": "<path into the write's result>" },
  "expect": [ { "probePath": "<path in the read>", "equalsResultPath": "<path in the write's result>" } ],
  "upstream": { "idPath": "<path in the upstream read response>", "equalsResultPath": "<path>" } }   (optional)
```
