# Mac Notes MCP Connector

Status: In progress
Author: stas@kolivri.com
Created: 2026-05-14

## Background

Claude Code supports Model Context Protocol (MCP) servers as connectors. There is no first-party connector that lets Claude read and write Apple Notes on macOS. This project provides one.

Apple Notes is scriptable on macOS through two surfaces:
- **AppleScript** (`tell application "Notes"`) — verbose, comma-joined output.
- **JXA (JavaScript for Automation)** — same scripting bridge, returns native JS objects which can be `JSON.stringify`'d for clean transport.

Both shell out via `/usr/bin/osascript`. Notes has no public REST API; the only stable third option is direct SQLite reads against `~/Library/Group Containers/group.com.apple.notes/NoteStore.sqlite`, which is brittle, requires Full Disk Access, and is read-only.

## Problem

Build an MCP server that lets Claude Code list, search, read, create, append-to, and edit notes in the macOS Notes app. The server must:

1. Run locally over stdio (the standard MCP transport).
2. Be installable via `npx` so users don't need a local clone.
3. Address notes by a stable identifier so multi-step flows (search → read → update) work reliably.
4. Disambiguate folders with the same name across accounts (iCloud, Google, On My Mac all expose a folder named "Notes").

Out of scope for v1: delete (destructive — too easy for an LLM to misfire), attachments, hashtags, password-protected notes, links between notes, image insertion.

## Questions & Answers

**Q: AppleScript or JXA for the bridge?**
A: JXA. Verified that `osascript -l JavaScript` returns a JSON string we can parse directly. AppleScript's default record output is comma-joined text that loses structure. Same underlying scripting bridge, same permission prompt, cleaner output.

**Q: How do we address a note?**
A: By its CoreData URI (e.g. `x-coredata://AB98D55D-.../ICNote/p274`). Verified these are stable across script invocations and are what `note.id()` returns in JXA. They round-trip: passing the URI to `Notes.notes.byId(uri)` returns the same note.

**Q: How do we handle the multiple "Notes" folder collision?**
A: Folders are always identified by their CoreData id when addressing them. The `list_folders` tool returns `{ account, name, id }` triples so callers can pick the right one. `create_note` accepts either an explicit `folderId` or a `{ account, folderName }` pair; if neither is given it falls back to the default account's "Notes" folder.

**Q: HTML or plain text bodies?**
A: Note bodies are HTML in Notes' storage (`<div>...<br></div>`). For inputs, accept plain text and wrap each line in `<div>` automatically; also accept raw HTML when the caller passes a string starting with `<`. For outputs, return the raw HTML *and* a plain-text rendering (HTML tags stripped, entities decoded) so the model can consume either.

**Q: How do we handle pagination for `list_notes`?**
A: Notes accounts can contain thousands of items, and every JXA property access is an Apple Event round-trip. Mitigations: (1) `limit` is always applied (default 50, max 500) regardless of whether a folder is specified; (2) all per-note property reads happen inside the JXA script so we don't cross the bridge N times. Verified `folder.notes()` returns the collection in one round-trip and the script-side iteration is fast (~20ms for 112 notes).

**Q: Permission model?**
A: The first `osascript` call triggers macOS Automation consent ("Terminal/Claude wants to control Notes"). The user must approve in System Settings → Privacy & Security → Automation. Document this in the README and surface a clear error if the call fails with errAEEventNotPermitted (-1743).

## Design

### Package layout

```
notes-connector-claude-code/
├── package.json                # bin: "mac-notes-mcp" → dist/index.js
├── tsconfig.json
├── README.md
├── design-log/
│   └── 0001-mac-notes-mcp.md
├── src/
│   ├── index.ts                # MCP server entrypoint, tool registration
│   ├── notes.ts                # Typed wrappers around JXA scripts
│   ├── jxa.ts                  # osascript runner + error mapping
│   ├── html.ts                 # HTML ↔ plain-text helpers
│   └── types.ts                # Shared TS types (Note, Folder, Account)
└── test/
    └── integration.test.ts     # Drives the real Notes app, isolated folder
```

Compiled output goes to `dist/`. `bin/mac-notes-mcp` is a thin shebang wrapper that requires `dist/index.js`.

### Tool surface

All tools use Zod input schemas. Outputs are JSON.

| Tool | Inputs | Output |
| --- | --- | --- |
| `list_accounts` | — | `Array<{ name, folders: Folder[] }>` |
| `list_folders` | — | `Array<{ id, name, account }>` |
| `list_notes` | `{ folderId?, account?, folderName?, limit?: 1..500=50 }` | `Array<NoteMeta>` |
| `search_notes` | `{ query, scope?: "name" \| "body" \| "both" = "both", limit?: 1..200=20 }` | `Array<NoteMeta>` |
| `read_note` | `{ id }` | `Note` (full body HTML + plaintext) |
| `create_note` | `{ title, body, folderId? \| (account?, folderName?), bodyFormat?: "text" \| "html" = "text" }` | `NoteMeta` |
| `append_to_note` | `{ id, body, bodyFormat?: "text" \| "html" = "text", separator?: string = "\n" }` | `NoteMeta` |
| `update_note` | `{ id, title?, body?, bodyFormat?: "text" \| "html" = "text" }` | `NoteMeta` |

Types:

```ts
type NoteMeta = { id: string; name: string; folder: string; account: string;
                  createdAt: string; modifiedAt: string };
type Note = NoteMeta & { bodyHtml: string; bodyText: string };
type Folder = { id: string; name: string; account: string };
```

### Bridge layer (`jxa.ts`)

Single function `runJxa<T>(script: string, args: unknown): Promise<T>`. It writes the args as JSON to a temp file path passed via `--`, then `child_process.execFile`s `osascript -l JavaScript -e '<wrapper>' <argsPath>`. The wrapper reads the file and calls a user-supplied `main(args)` defined inline.

Why a file and not `-e` args directly: shell-quoting JSON payloads with embedded HTML bodies is fragile. A temp file avoids it. The file is unlinked in a `finally`.

Errors: parse `osascript` stderr for known codes:
- `-1743` → AutomationNotPermitted (instruct user to grant access in System Settings)
- `-1728` → NoteNotFound (note id does not resolve)
- `-2741` / syntax → ScriptError (internal bug, surface as-is)

### Notes adapter (`notes.ts`)

Each MCP tool maps to a JXA script string. Scripts are kept minimal — they take the parsed `args`, perform the operation, return a JS object. All formatting (HTML stripping, ISO date conversion) happens script-side because crossing the osascript boundary is expensive.

`Notes.notes.byId(uri)` is the only addressing primitive. For `list_notes` with a folder filter, use `folder.notes()` rather than `Notes.notes.whose(...)` — verified the former is faster on large databases.

### MCP server (`index.ts`)

Uses `@modelcontextprotocol/sdk/server` with `StdioServerTransport`. Each tool is registered with a Zod schema. The server logs to stderr only (stdout is the MCP transport). Tool handlers wrap adapter calls in try/catch and convert known errors into MCP error responses with a human-readable message.

## Implementation Plan

1. **Scaffold** — `package.json` (ESM, `bin`, `tsc` build), `tsconfig.json`, `.gitignore`.
2. **Bridge** — `jxa.ts` with runner + error mapping.
3. **Adapter** — `notes.ts` implementing each operation against JXA.
4. **HTML helpers** — `html.ts` (text→HTML wrapping, HTML→text stripping).
5. **MCP server** — `index.ts` registering all tools.
6. **Integration tests** — create a temp folder named `mcp-test-<uuid>`, exercise every tool, delete the folder at end via AppleScript (test-only; not exposed as a tool).
7. **README** — install, Claude Code config snippet, permission setup, examples.
8. **Verify** — build, register locally, drive a tool through Claude Code.

## Examples

Search and read:

```jsonc
// search_notes
{ "query": "invite url", "scope": "body", "limit": 5 }
// → [{ "id": "x-coredata://.../ICNote/p274", "name": "why its invited…", ... }]

// read_note
{ "id": "x-coredata://.../ICNote/p274" }
// → { "id": "...", "bodyHtml": "<div><tt>why…</tt></div>", "bodyText": "why…", ... }
```

Create:

```jsonc
{ "title": "Grocery list", "body": "milk\neggs\nbread",
  "account": "iCloud", "folderName": "Notes" }
```

## Trade-offs

- **JXA round-trips are slow.** A single `list_notes` on a 5000-note folder takes ~3s because every property access is an Apple Event. Mitigation: cap `limit`, do all property reads inside the script. Accepted: not optimizing further until a real workload demands it.
- **HTML in / HTML out.** Notes is fundamentally HTML; trying to hide that creates fidelity loss (lost bullets, links, formatting). Decision: expose both. The plaintext rendering is lossy but convenient; the HTML is authoritative.
- **No delete in v1.** Reduces blast radius. If a user explicitly asks Claude to delete a note, Claude can instruct them to do it manually or we add it in v2 behind an opt-in flag.
- **npx distribution requires a published npm package.** Adds release overhead. For v1, document both `npx @kolivri/mac-notes-mcp` (after publish) and `node /path/to/dist/index.js` (local dev).

## Verification Criteria

1. `npm run build` produces `dist/index.js` with a working shebang.
2. Integration test (`npm test`) runs end-to-end against the real Notes app: creates a folder, creates a note, lists, searches, reads, appends, updates, asserts each result, cleans up the folder. Must pass on the development machine.
3. Server registered in `~/.claude/settings.json` boots without error; `claude mcp list` shows it healthy.
4. From a fresh Claude Code session, running a prompt that hits each tool returns the expected data.
5. AppleScript permission denial (`-1743`) surfaces a clear error message instructing the user how to grant access.

## Implementation Results

### Deviations from the Design

- **JXA argv vs. temp file** — Design section said args would be written to a temp file and passed by path. Implementation passes the JSON args as a direct `execFile` argv element. Reason: `child_process.execFile` does not spawn a shell, so the quoting risk that motivated the temp-file approach does not exist. One less code path, one less cleanup concern.

- **Account resolution for `noteMeta`** — Design implied `n.container().container()` gives the account. That breaks for notes inside subfolders, where `n.container()` is a subfolder and `n.container().container()` is its parent folder, not the account. Implementation walks the `container()` chain until it finds an id containing `"Account/"` (CoreData URIs distinguish `ICAccount`/`IMAPAccount` from `ICFolder`/`IMAPFolder`).

- **`create_note` title handling** — Original sketch passed both a `name:` property and an `<h1>` body prefix, which produced a duplicated title in Notes (the displayed title comes from the first line of the body; `name:` is derived, not authoritative). Implementation prepends only `<div><b>title</b></div>` and drops the `name:` argument.

- **`create_note` retrieval** — Originally would have used `folder.notes()[0]` to recover the just-created note (relying on Notes' default desc-by-modified ordering). Implementation keeps the live JXA object reference returned by `Notes.Note({...})` and calls `noteMeta(n)` on it directly. Avoids both the ordering assumption and a race with iCloud sync.

- **Search scope** — Design said substring across name/body. Implementation strips HTML tags from the body before substring match, so a query like `"div"` doesn't match every note and `"foo"` doesn't have to step around `<tt>`/`<div>` noise. Name matching is unchanged.

- **`append_to_note` default separator** — Design table showed `"\n"`; implementation uses `""`. Notes bodies are HTML and a literal `\n` between two `<div>...</div>` blocks renders as nothing extra anyway. The empty default is the more honest representation; callers wanting a visible break pass `"\n"` (which becomes `<div>\n</div>`) or `"<div><br></div>"` explicitly.

- **Test-only helpers moved out** — Original layout had `createFolder`/`deleteFolder`/`deleteNote` in `src/notes.ts`. They moved to `src/test-helpers.ts` so they are clearly not part of the production API. The MCP tool surface remains read + write + edit, no delete.

- **`.npmignore` dropped** — Design did not mention publishing hygiene explicitly. `package.json#files` is a positive allowlist (`dist`, `README.md`, `LICENSE`), so `.npmignore` was both redundant and confusing. Removed.

### Test Results

- `npm run build` — clean (`tsc` + chmod, no errors).
- `npm test` — **12/12 pass** in ~13s on the development machine. Suite covers HTML helpers and an end-to-end run that creates a folder, exercises every adapter operation, and cleans up.
- MCP stdio smoke test — server boots, completes the `initialize` handshake, and `tools/list` returns all 8 tools (`list_accounts`, `list_folders`, `list_notes`, `search_notes`, `read_note`, `create_note`, `append_to_note`, `update_note`).
- MCP `tools/call` end-to-end — `list_accounts` invoked over stdio returns the four real accounts (Google, iCloud, Kolivri, On My Mac) with their folder counts.

### Verification Criteria Status

1. Build with shebang — DONE.
2. Integration test end-to-end — DONE (12/12).
3. Server registered and visible via `claude mcp list` — DOCUMENTED in `README.md`; user registers after install.
4. Tool invocation from Claude Code — DEMONSTRATED via the equivalent stdio handshake test in this session.
5. Permission denial surfaces a clear error — IMPLEMENTED via `JxaError("PERMISSION_DENIED", …)` with the System Settings hint; not exercised here because Automation consent is already granted on this machine.
