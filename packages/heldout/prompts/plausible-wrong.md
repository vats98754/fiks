# Task

The vendor API behind this server changed its behaviour silently. The reference fix below makes
the server correct again. Write a different patch that a reviewer could plausibly accept as a fix
for the same symptom but that is NOT correct: it must leave some inputs, responses or flows wrong
(for example: it fixes only the case visible in the symptom, assumes something the vendor does not
guarantee, breaks the previous vendor behaviour, or hides the symptom instead of repairing it).
Do not mention that it is wrong in comments. Variant {{SAMPLE}} of {{COUNT}}: make it differ from
the other variants in how it is wrong.

# What changed upstream

{{DESCRIPTION}}

# Reference fix (for orientation; do not reproduce it)

```diff
{{REF_DIFF}}
```

# Base source files

{{FILES}}
