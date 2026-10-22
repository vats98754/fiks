# Tracker API

The Tracker API is the HTTP interface of a team issue tracker: issues, their comments, labels and
assignees, a search endpoint, and a small state workflow. The machine-readable description is
`openapi.json` next to this file. This page explains the behaviour the schema cannot express.

## Conventions

- Requests and responses are JSON (`content-type: application/json`).
- Every response carries a `Tracker-Api-Version` header. Its value is the date of the API version
  that produced the response.
- Timestamps are ISO-8601 instants in UTC, for example `created_at` and `updated_at`.
- Errors use a non-2xx status and the body `{"error": "<code>", "message": "<text>"}`.
- User names, labels and comment authors are lower-case names made of letters, digits, `:`, `_`,
  `.` and `-`.

## Issues

An issue is identified by its `key` (for example a project prefix, a dash and a number). Fields:

| Field | Meaning |
|---|---|
| `key` | The issue's identifier. |
| `title` | One-line summary. |
| `type` | `bug`, `task` or `feature`. |
| `state` | `open`, `in_progress`, `resolved` or `closed`. |
| `priority` | `low`, `medium`, `high` or `urgent`. |
| `labels` | Label names, in the order they were added. |
| `assignees` | User names, in the order they were added. |
| `reporter` | The user who filed the issue. |
| `story_points` | The team's estimate in story points, or `null` when the issue is not estimated. |
| `created_at` | When the issue was filed. |
| `updated_at` | The last change to the issue: a state change, a label or assignee change, or a new comment. |
| `comment_count` | How many comments the issue has (only on `GET /issues/{key}`). |

`GET /issues/{key}` returns one issue, or `404` for an unknown key.

## Search

`GET /issues` returns the issues that match every given filter:

- `q`: text that appears in the title (case-insensitive), or an exact issue key. Without `q`, or
  with an empty `q`, every issue matches.
- `type`, `state`: exact values from the enumerations above. An unknown value is a `400`.
- `label`, `assignee`: issues that carry this label or are assigned to this user.

Results come back one page at a time, always in the same order:

```json
{ "items": [ ... ], "total": <matches over all pages>, "page": <this page>, "next_page": <next page or null> }
```

Request the next page with `page=<next_page>` (and the same filters) until `next_page` is `null`.
The page size is chosen by the server and may change; clients must follow `next_page` rather than
assume a size. `total` counts every match, not only the current page. Search items carry the
summary fields (`key`, `title`, `type`, `state`, `priority`, `labels`, `assignees`,
`updated_at`); fetch the issue for the rest.

## Comments

- `GET /issues/{key}/comments` returns `{"issue_key", "items", "total"}`: every comment of the
  issue, oldest first, in one response. `total` is the number of comments.
- `POST /issues/{key}/comments` with `{"body": "...", "author": "..."}` stores a comment and
  returns it with status `201`. `author` is optional (default `api`). An empty body is a `400`.
  The new comment's `created_at` is the time the server stored it, and the issue's `updated_at`
  moves to the same instant.

A comment has `id`, `issue_key`, `author`, `body` and `created_at`.

## Workflow

`POST /issues/{key}/transitions` with `{"to": "<state>"}` moves an issue to another state. The
allowed moves are:

| From | To |
|---|---|
| `open` | `in_progress`, `closed` |
| `in_progress` | `open`, `resolved` |
| `resolved` | `open`, `closed` |
| `closed` | `open` |

A successful move returns `{"key", "state", "previous_state", "updated_at"}`. A move that is not
allowed from the issue's current state (including a move to the state it is already in) returns
`409` with error `invalid_transition` and leaves the issue unchanged. An unknown target state is a
`400`.

## Labels and assignees

`POST /issues/{key}/labels` and `POST /issues/{key}/assignees` take
`{"add": [names], "remove": [names]}` (either list may be omitted, but not both). Removals apply
first, then additions; adding a name that is already present changes nothing, and removing an
absent name is not an error. The response is the full list after the change:
`{"key", "labels", "updated_at"}` or `{"key", "assignees", "updated_at"}`.

## Versioning

The API is versioned by date. The version that produced a response is in its
`Tracker-Api-Version` header.
