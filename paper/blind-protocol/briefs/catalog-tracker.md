# Catalog brief: tracker

You are writing data for the Tracker API, an issue tracker used by a software team. The public
documentation of the API is in `docs/`. Read it first.

Write exactly 25 new issues that this team could plausibly have in its tracker. Each issue has
the fields the docs describe for an issue, except its key:

- `title`, `type`, `state`, `priority`: as described in the docs, with the documented values.
- `labels` and `assignees`: lists of lower-case names, as in the docs (either may be empty).
- `reporter`: the lower-case name of the person who filed the issue.
- `story_points`: the estimate, as a JSON number, or null when the issue is not estimated.
- `created_at` and `updated_at`: timestamps in the format the docs describe.
- `comments`: a list of comments, each with `author`, `body` and `created_at` (may be empty).

Do not write a `key` field: keys are assigned when your issues are loaded. Write issues a real
team would file: realistic titles, people, labels, estimates, dates and discussions. Vary them;
do not copy each other's issues. You may read the files in your working directory; you have no
other source of information.

Return your issues as the structured result `{"entities": [ ... ]}`.
