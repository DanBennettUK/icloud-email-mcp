# icloud-email-mcp

Node.js MCP server for iCloud Email via IMAP — deployed as a Vercel serverless function.

## Authentication

All requests require auth via one of:
- `Authorization: Bearer <POKE_API_KEY>`
- `X-Api-Key: <POKE_API_KEY>`
- `?key=<POKE_API_KEY>` query parameter

## Environment variables

| Variable | Description |
|---|---|
| `IMAP_USER` | iCloud email address |
| `IMAP_PASSWORD` | iCloud app-specific password |
| `POKE_API_KEY` | Secret key for request authentication |

## Tools (7 total)

- `list_mailboxes` — list all mailboxes/folders
- `list_emails` — list recent emails from a mailbox
- `get_email` — get full content of an email by UID
- `search_emails` — search emails by subject, sender, or date
- `get_mailbox_status` — get total and unread counts for a mailbox
- `archive_email` — archive an email by UID
- `move_email` — move an email to a different mailbox

## Dependencies

```json
{
  "imap": "^0.8.19",
  "mailparser": "^3.7.2"
}
```
