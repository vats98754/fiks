# Fault taxonomy (reference for authors)

A study of runtime faults in MCP servers sorts them into categories. The three largest are:

- **Tool faults**: the tool does the wrong thing with a correct upstream answer.
- **Data and schema faults**: values, units, field names, formats or shapes differ from what the
  consumer expects.
- **State and configuration faults**: writes that do not persist, stale state, wrong versions,
  missing headers or settings.

Developers also report faults in tool execution and in how tool results are passed back to the
agent. A frequent observation is the "gray failure": the server returns a well-formed success
response although the behaviour is wrong, so crash- or error-based detection misses it.

Symptom classes seen in real servers (one line each):

- R1 a write reports success but the change is not stored (lost write, false success).
- R2 a list is truncated: fewer items than the reported total, no next-page signal.
- R3 a field present upstream is dropped from the tool's result.
- R4 a missing field is replaced by a default that reads as a real value.
- R5 a value is encoded twice (or decoded wrongly) and still looks valid.
- R6 a write targets the wrong parent or container.
- R7 a count reports the wrong quantity (a limit or a length instead of a total).
- R8 an upstream error is swallowed and returned as an empty success.
- R9 an object is serialized as a placeholder string.
- R10 a batch write silently drops some of its elements.
- R11 a pagination cursor is not forwarded although more pages exist.
- R12 a filter drops records that match.
- R13 a pagination token is omitted from the result.
- R14 a hard item cap hides further pages.
- R15 an argument is ignored, so results do not match the request.
- R16 a new upstream version returns empty identifiers.
- R17 a time range or other formatted value is rendered wrongly.
- R18 a serialization problem produces an empty payload.
- R19 a count reports the length of a string instead of the number of rows.
- R20 a write reports success but produced nothing.
- R21 a cap inside a nested object truncates it silently.
- R22 an unknown enumeration value falls through to a known one.
- R23 an aggregate is computed from double-counted parts.
- R24 pagination metadata disappears above some size.
- R25 a unit changes (for example major to minor currency units) without a field change.
