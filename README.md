# iCloud MCP Server v2.0.0

A modular Model Context Protocol (MCP) server that enables Claude to interact with your iCloud account. This version is deployed as a Vercel serverless function and provides a unified interface for Email, Calendar, and Contacts.

## Features

- **Email**: Read, search, mark as read, and **send emails** (via IMAP/SMTP).
- **Calendar**: List upcoming events, create new events, and delete events (via CalDAV).
- **Contacts**: List, search, read, and create contacts (via CardDAV).
- **Modular Architecture**: Clean separation of concerns with dedicated clients for each service.

## Configuration

The server requires the following environment variables:

- `ICLOUD_EMAIL`: Your full iCloud email address (e.g., `user@icloud.com`).
- `ICLOUD_APP_PASSWORD`: An app-specific password generated at [appleid.apple.com](https://appleid.apple.com).
- `POKE_API_KEY`: (Optional) Security key to authorize MCP requests.

## Deployment

This server is optimized for deployment on **Vercel** as a serverless function. The entry point is `api/mcp.js`.

## Tool Summary

### Email
- `list-emails`: Lists recent emails from a folder.
- `read-email`: Gets full content of an email.
- `send-email`: Sends a new email via SMTP.
- `search-emails`: Search by query, sender, or subject.
- `mark-as-read`: Toggle seen status.
- `list-folders`: List all mailbox folders.

### Calendar
- `list-events`: Show upcoming events.
- `create-event`: Add a new event to a calendar.
- `delete-event`: Remove an event.
- `list-calendars`: List all available calendars.

### Contacts
- `list-contacts`: List your address book.
- `search-contacts`: Find contacts by name or info.
- `read-contact`: Get detailed contact cards.
- `create-contact`: Add a new contact.
- `delete-contact`: Remove a contact.
