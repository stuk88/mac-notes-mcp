# mac-notes-mcp

An MCP server that lets Claude Code read, search, and edit notes in the macOS Notes app.

Runs locally over stdio. Talks to Notes via JXA (`/usr/bin/osascript -l JavaScript`). Works with every Notes account on your machine — iCloud, Google, On My Mac, IMAP — without touching the Notes SQLite database directly.

## Requirements

- macOS (the package is marked `"os": ["darwin"]`)
- Node.js 18 or later
- The Notes app installed and at least one account configured

## Install

```sh
npm install -g @kolivri/mac-notes-mcp
```

Or run without installing globally:

```sh
npx @kolivri/mac-notes-mcp
```

## Register with Claude Code

Add it to your Claude Code MCP config (usually `~/.claude/settings.json`):

```jsonc
{
  "mcpServers": {
    "mac-notes": {
      "command": "npx",
      "args": ["-y", "@kolivri/mac-notes-mcp"]
    }
  }
}
```

Or, if you installed globally:

```jsonc
{
  "mcpServers": {
    "mac-notes": {
      "command": "mac-notes-mcp"
    }
  }
}
```

Restart Claude Code, then run `claude mcp list` to confirm it's connected.

## Permissions

The first time the server tries to read or write Notes, macOS will prompt you to authorize Automation access. Approve it. If you missed the prompt, grant it manually:

**System Settings → Privacy & Security → Automation** → expand the entry for your terminal (or for Claude Code) → enable **Notes**.

If you skip this, every tool call fails with `PERMISSION_DENIED` and a hint pointing here.

## Tools

| Tool | What it does |
| --- | --- |
| `list_accounts` | Returns every Notes account with its folders. |
| `list_folders` | Flat list of folders across all accounts. |
| `list_notes` | List notes, optionally restricted to one folder. Default limit 50, max 500. |
| `search_notes` | Case-insensitive substring search across note titles and/or bodies. HTML tags are stripped before matching. |
| `read_note` | Fetch a note by id. Returns both HTML body and a plain-text rendering. |
| `create_note` | Create a new note in a folder. `body` defaults to plain text (each line wrapped in `<div>`); pass `bodyFormat: "html"` for raw HTML. |
| `append_to_note` | Append content to an existing note. |
| `update_note` | Replace a note's title and/or body. |

### Addressing folders

A "Notes" folder usually exists in multiple accounts. Two ways to disambiguate:

- Pass `folderId` (the stable CoreData URI returned by `list_folders` / `list_accounts`).
- Pass `account` and `folderName` together (e.g. `account: "iCloud"`, `folderName: "Notes"`).

Without either, `create_note` writes to the default account's default folder.

### Examples

```jsonc
// Find every account and folder
{ "name": "list_accounts" }

// Search the iCloud Notes folder for a substring
{
  "name": "search_notes",
  "arguments": {
    "query": "weekly review",
    "account": "iCloud",
    "folderName": "Notes",
    "limit": 20
  }
}

// Create a plain-text note
{
  "name": "create_note",
  "arguments": {
    "title": "Grocery list",
    "body": "milk\neggs\nbread",
    "account": "iCloud",
    "folderName": "Notes"
  }
}

// Append to an existing note
{
  "name": "append_to_note",
  "arguments": {
    "id": "x-coredata://.../ICNote/p274",
    "body": "another bullet",
    "separator": "\n"
  }
}
```

## What this server does NOT do

- **Delete notes or folders.** Out of scope by design. Doing so safely requires a user confirmation step that doesn't exist in MCP yet.
- **Manage attachments, links, or password-protected notes.**
- **Bulk export.** This is for interactive Claude Code workflows, not migrations.

## Development

```sh
git clone <repo>
cd notes-connector-claude-code
npm install
npm run build      # compile TS -> dist/
npm test           # run integration tests against the real Notes app
```

The integration test creates a folder named `mcp-test-<uuid>` in your default account, exercises every tool, and deletes the folder at the end. If a run is interrupted, the folder may need manual cleanup (look in the Notes sidebar).

Design decisions and trade-offs live in [`design-log/0001-mac-notes-mcp.md`](design-log/0001-mac-notes-mcp.md).

## License

MIT
