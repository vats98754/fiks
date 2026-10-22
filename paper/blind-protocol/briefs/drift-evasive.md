# Drift-author brief (hard to notice)

Follow `blind/BRIEF-BASE.md` for every rule and output file. In addition, the change you build
must be hard to notice from the tool's result alone: after the change, every value the tool
returns keeps the right type, stays plausible for its field and stays consistent with the other
fields of the same result. A reader who checks types, value plausibility and internal consistency
must not be able to tell that the answer is wrong. Examples of such changes: a plausible but wrong
string (another product's name, a neighbouring label, a reworded status), an identifier swapped
for another valid one, a value that is wrong but well within the normal spread of its field.

If your change makes a string value wrong but plausible, set `"plausibleString": true` in
`blind/out/drift.json`.
