# Ideation brief

You design test cases for a study of how MCP servers cope with changes in the vendor APIs they
wrap. Below are the vendor's public documentation and a taxonomy of real faults.

Propose distinct ideas for one upstream change each. A change alters the behaviour of the vendor's
responses but not its published API description, and it makes the wrapping server return wrong
results without an error. Spread the ideas over the endpoints, the taxonomy categories and the
symptom classes; do not repeat an idea.

Return a JSON object `{ "ideas": [ { "title", "description", "endpoint", "category", "symptom", "plausibleString": boolean }, ... ] }`
with exactly the number of ideas requested.
