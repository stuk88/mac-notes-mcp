#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { appendToNote, createNote, listAccounts, listFolders, listNotes, readNote, searchNotes, updateNote, } from "./notes.js";
import { JxaError } from "./jxa.js";
const server = new McpServer({
    name: "mac-notes-mcp",
    version: "0.1.0",
});
function ok(value) {
    return {
        content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    };
}
function fail(err) {
    const message = err instanceof JxaError
        ? `${err.code ?? "JXA_ERROR"}: ${err.message}`
        : err instanceof Error
            ? err.message
            : String(err);
    return {
        content: [{ type: "text", text: message }],
        isError: true,
    };
}
async function safe(fn) {
    try {
        return ok(await fn());
    }
    catch (e) {
        return fail(e);
    }
}
server.registerTool("list_accounts", {
    title: "List Notes accounts",
    description: "Returns every Notes account (iCloud, Google, On My Mac, etc.) with the folders it contains.",
    inputSchema: {},
}, async () => safe(listAccounts));
server.registerTool("list_folders", {
    title: "List folders",
    description: "Returns a flat list of folders across all accounts. Each entry has an id, name, and account name.",
    inputSchema: {},
}, async () => safe(listFolders));
server.registerTool("list_notes", {
    title: "List notes",
    description: "List notes, optionally restricted to one folder. Folder is selected by folderId or by (account, folderName). Returns up to `limit` notes (default 50, max 500).",
    inputSchema: {
        folderId: z.string().optional(),
        account: z.string().optional(),
        folderName: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
    },
}, async (args) => safe(() => listNotes(args)));
server.registerTool("search_notes", {
    title: "Search notes",
    description: "Case-insensitive substring search across note names and/or bodies. Scope: 'name', 'body', or 'both' (default).",
    inputSchema: {
        query: z.string().min(1),
        scope: z.enum(["name", "body", "both"]).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        folderId: z.string().optional(),
        account: z.string().optional(),
        folderName: z.string().optional(),
    },
}, async (args) => safe(() => searchNotes(args)));
server.registerTool("read_note", {
    title: "Read note",
    description: "Fetch a note's full content by id. Returns metadata plus both HTML and plain-text renderings of the body.",
    inputSchema: {
        id: z.string().min(1),
    },
}, async ({ id }) => safe(() => readNote(id)));
server.registerTool("create_note", {
    title: "Create note",
    description: "Create a new note. Provide `title` and `body`. By default the body is treated as plain text and wrapped in <div>s; pass bodyFormat='html' to provide HTML directly. Target folder is selected by folderId or (account, folderName); without either, the default account's default folder is used.",
    inputSchema: {
        title: z.string().min(1),
        body: z.string(),
        bodyFormat: z.enum(["text", "html"]).optional(),
        folderId: z.string().optional(),
        account: z.string().optional(),
        folderName: z.string().optional(),
    },
}, async (args) => safe(() => createNote(args)));
server.registerTool("append_to_note", {
    title: "Append to note",
    description: "Append content to an existing note's body. `separator` is inserted between the existing body and the new content (default: none).",
    inputSchema: {
        id: z.string().min(1),
        body: z.string(),
        bodyFormat: z.enum(["text", "html"]).optional(),
        separator: z.string().optional(),
    },
}, async (args) => safe(() => appendToNote(args)));
server.registerTool("update_note", {
    title: "Update note",
    description: "Replace a note's title and/or body. Omit a field to leave it unchanged. body replaces the entire body (use append_to_note to add).",
    inputSchema: {
        id: z.string().min(1),
        title: z.string().optional(),
        body: z.string().optional(),
        bodyFormat: z.enum(["text", "html"]).optional(),
    },
}, async (args) => safe(() => updateNote(args)));
const transport = new StdioServerTransport();
try {
    await server.connect(transport);
    process.stderr.write("mac-notes-mcp started\n");
}
catch (err) {
    process.stderr.write(`mac-notes-mcp failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
}
//# sourceMappingURL=index.js.map