# Contract-author brief (tool descriptions and samples)

An MCP server exposes tools to AI agents. Your job is to write behavioural checks that every
result of these tools must satisfy, so that a result that is well-formed but wrong can be told
apart from a correct one.

Your working directory holds:

- `tools/tools.json`: each tool's name, description, input schema and declared output schema.
- `calls/`: sample tool calls with their results and the raw upstream HTTP exchanges they caused.
  These samples are correct behaviour.

Do not write a check that a correct result could fail: every check must hold on every sample.

Write checks for every tool in `tools/tools.json`. You may use Bash (it runs offline in a container
rooted at your working directory) to inspect the samples. You have no other source of information.

The output format follows.
