# Ideation brief (legitimate evolution)

You design test cases for a study of how MCP servers cope with changes in the vendor APIs they
wrap. Below is the vendor's public documentation.

Propose distinct ideas for one legitimate API evolution each: a change a careful vendor ships
without breaking correct clients (a new optional field, a new documented enumeration value, a
wider legitimate range, a different array order where order was never promised, a deprecated field
kept with an alias, a new pagination parameter with an unchanged default, a documented unit change
with a new explicit unit field). Spread the ideas over the endpoints and classes.

Return a JSON object `{ "ideas": [ { "title", "description", "endpoint", "benignClass" }, ... ] }`
with exactly the number of ideas requested.
