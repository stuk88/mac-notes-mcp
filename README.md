# mac-notes-mcp

An MCP server that lets Claude Code read, search, and edit notes in the macOS Notes app.

Runs locally over stdio. Talks to Notes via JXA (`/usr/bin/osascript -l JavaScript`). Works with every Notes account on your machine — iCloud, Google, On My Mac, IMAP — without touching the Notes SQLite database directly.

## Requirements

- macOS (the package is marked `"os": ["darwin"]`)
- Node.js 18 or later
- The Notes app installed and at least one account configured

## Install

### Option A — Claude Code plugin marketplace (recommended)

Add the marketplace, then install the plugin:

```sh
claude plugin marketplace add stuk88/mac-notes-mcp
claude plugin install mac-notes@mac-notes-mcp
```

That's it. Claude Code spawns the MCP server automatically; no separate registration needed. The compiled `dist/` is shipped in the repo, so you don't need to run `npm install` or `npm run build`.

### Option B — Standalone MCP server

If you'd rather wire it up yourself (no plugin manager):

```sh
git clone https://github.com/stuk88/mac-notes-mcp
cd mac-notes-mcp
npm install
npm run build
```

## Register with Claude Code (Option B only)

Point Claude Code at the compiled entry. The cleanest way is the built-in CLI:

```sh
claude mcp add --scope user mac-notes -- node /absolute/path/to/mac-notes-mcp/dist/index.js
```

Then verify:

```sh
claude mcp list
```

You should see `mac-notes ... ✓ Connected`.

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

## Author

Built by **[Stas Arshanski](https://github.com/stuk88)** at **[Kolivri.com](https://kolivri.com)**.
Issues and pull requests welcome at [github.com/stuk88/mac-notes-mcp](https://github.com/stuk88/mac-notes-mcp).

## License

MIT &copy; Stas Arshanski / [Kolivri.com](https://kolivri.com)
