# Multi Link Account Credentials Design

## Goal

Allow one account to contain multiple link rows. Each row has its own link type, URL, username, and password. Empty rows are ignored when saving and are not shown in detail.

## Design

Extend the existing `entry_credentials` model instead of adding a new table. Each credential row becomes a link credential row with these visible fields:

- `linkType`: CMS, Web, Database, or another short label.
- `url`: the URL opened from that row.
- `username`: the username for that row.
- `password`: the encrypted password for that row.

The parent account remains the grouping container with name, project/system/type, notes, and tags.

## Permissions

Existing entry permissions continue to apply. Admin users can view and reveal every credential row. Non-admin users only receive rows for their departments and only see URL, username, notes, or password reveal actions when their detailed permissions allow it.

## UI Behavior

The account form renders multiple rows with link type, URL, username, and password. When saving, rows with no URL, username, and password are filtered out. Existing rows without a newly typed password keep their encrypted password.

The detail panel renders only saved rows. Each row has its own open-link action, username copy, password reveal, and password copy. Opening a link uses the browser target (`target="_blank"`), so Electron/Chrome can open it directly.

## Data Compatibility

Existing `entry.url` and `entry.username` continue to work as fallback values. Existing credential rows without `linkType` default to `Account`; rows without row-level URL fall back to the old account URL until edited.
