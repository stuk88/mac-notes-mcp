import { runJxa } from "./jxa.js";
import { escapeHtml, htmlToText, normalizeBody } from "./html.js";
import type { Account, BodyFormat, Folder, Note, NoteMeta } from "./types.js";

const JXA_HELPERS = `
  function resolveFolder(args) {
    var Notes = Application("Notes");
    if (args.folderId) {
      return Notes.folders.byId(args.folderId);
    }
    if (args.account || args.folderName) {
      var accounts = Notes.accounts();
      var target = null;
      for (var i = 0; i < accounts.length; i++) {
        var acct = accounts[i];
        if (args.account && acct.name() !== args.account) continue;
        var folders = acct.folders();
        for (var j = 0; j < folders.length; j++) {
          if (!args.folderName || folders[j].name() === args.folderName) {
            target = folders[j];
            break;
          }
        }
        if (target) break;
      }
      if (!target) {
        throw new Error("Folder not found for account=" + args.account + " name=" + args.folderName);
      }
      return target;
    }
    return Notes.defaultAccount().defaultFolder();
  }
  function accountOf(node) {
    var current = node.container();
    var hops = 0;
    while (hops < 16 && current.id().indexOf("Account/") < 0) {
      current = current.container();
      hops++;
    }
    return current;
  }
  function noteMeta(n) {
    return {
      id: n.id(),
      name: n.name(),
      folder: n.container().name(),
      account: accountOf(n).name(),
      createdAt: n.creationDate().toISOString(),
      modifiedAt: n.modificationDate().toISOString(),
    };
  }
`;

export async function listAccounts(): Promise<Account[]> {
  return runJxa<Account[]>(`
    ${JXA_HELPERS}
    function main() {
      var Notes = Application("Notes");
      return Notes.accounts().map(function (a) {
        return {
          name: a.name(),
          folders: a.folders().map(function (f) {
            return { id: f.id(), name: f.name(), account: a.name() };
          }),
        };
      });
    }
  `);
}

export async function listFolders(): Promise<Folder[]> {
  const accounts = await listAccounts();
  return accounts.flatMap((a) => a.folders);
}

export async function listNotes(opts: {
  folderId?: string;
  account?: string;
  folderName?: string;
  limit?: number;
}): Promise<NoteMeta[]> {
  const limit = clampLimit(opts.limit, 50, 500);
  return runJxa<NoteMeta[]>(
    `
    ${JXA_HELPERS}
    function main(args) {
      var Notes = Application("Notes");
      var source;
      if (args.folderId || args.account || args.folderName) {
        var folder = resolveFolder(args);
        source = folder.notes();
      } else {
        source = Notes.notes();
      }
      var out = [];
      var max = Math.min(source.length, args.limit);
      for (var i = 0; i < max; i++) {
        out.push(noteMeta(source[i]));
      }
      return out;
    }
  `,
    { ...opts, limit },
  );
}

export async function searchNotes(opts: {
  query: string;
  scope?: "name" | "body" | "both";
  limit?: number;
  folderId?: string;
  account?: string;
  folderName?: string;
}): Promise<NoteMeta[]> {
  const limit = clampLimit(opts.limit, 20, 200);
  const scope = opts.scope ?? "both";
  return runJxa<NoteMeta[]>(
    `
    ${JXA_HELPERS}
    function stripHtml(s) {
      return String(s)
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\\s+/g, " ");
    }
    function main(args) {
      var Notes = Application("Notes");
      var source;
      if (args.folderId || args.account || args.folderName) {
        source = resolveFolder(args).notes();
      } else {
        source = Notes.notes();
      }
      var needle = String(args.query).toLowerCase();
      var out = [];
      for (var i = 0; i < source.length && out.length < args.limit; i++) {
        var n = source[i];
        var nameHit = args.scope !== "body" && n.name().toLowerCase().indexOf(needle) >= 0;
        var bodyHit = false;
        if (!nameHit && args.scope !== "name") {
          bodyHit = stripHtml(n.body()).toLowerCase().indexOf(needle) >= 0;
        }
        if (nameHit || bodyHit) {
          out.push(noteMeta(n));
        }
      }
      return out;
    }
  `,
    { ...opts, limit, scope },
  );
}

export async function readNote(id: string): Promise<Note> {
  const raw = await runJxa<NoteMeta & { bodyHtml: string }>(
    `
    ${JXA_HELPERS}
    function main(args) {
      var Notes = Application("Notes");
      var n = Notes.notes.byId(args.id);
      var meta = noteMeta(n);
      meta.bodyHtml = n.body();
      return meta;
    }
  `,
    { id },
  );
  return { ...raw, bodyText: htmlToText(raw.bodyHtml) };
}

export async function createNote(opts: {
  title: string;
  body: string;
  bodyFormat?: BodyFormat;
  folderId?: string;
  account?: string;
  folderName?: string;
}): Promise<NoteMeta> {
  const html = normalizeBody(opts.body, opts.bodyFormat ?? "text");
  // Notes derives the title from the first line of the body. Prepend the
  // title as a visible heading so the user-supplied title actually wins,
  // regardless of whether body starts with a styled line.
  const titleHtml = `<div><b>${escapeHtml(opts.title)}</b></div>`;
  return runJxa<NoteMeta>(
    `
    ${JXA_HELPERS}
    function main(args) {
      var Notes = Application("Notes");
      var folder = resolveFolder(args);
      var note = Notes.Note({ body: args.titleHtml + args.bodyHtml });
      folder.notes.push(note);
      return noteMeta(note);
    }
  `,
    {
      titleHtml,
      bodyHtml: html,
      folderId: opts.folderId,
      account: opts.account,
      folderName: opts.folderName,
    },
  );
}

export async function appendToNote(opts: {
  id: string;
  body: string;
  bodyFormat?: BodyFormat;
  separator?: string;
}): Promise<NoteMeta> {
  const addition = normalizeBody(opts.body, opts.bodyFormat ?? "text");
  const separator = opts.separator ?? "";
  return runJxa<NoteMeta>(
    `
    ${JXA_HELPERS}
    function main(args) {
      var Notes = Application("Notes");
      var n = Notes.notes.byId(args.id);
      var sep = args.separator ? ("<div>" + args.separator + "</div>") : "";
      n.body = n.body() + sep + args.addition;
      return noteMeta(n);
    }
  `,
    { id: opts.id, addition, separator },
  );
}

export async function updateNote(opts: {
  id: string;
  title?: string;
  body?: string;
  bodyFormat?: BodyFormat;
}): Promise<NoteMeta> {
  const html =
    opts.body === undefined ? undefined : normalizeBody(opts.body, opts.bodyFormat ?? "text");
  return runJxa<NoteMeta>(
    `
    ${JXA_HELPERS}
    function main(args) {
      var Notes = Application("Notes");
      var n = Notes.notes.byId(args.id);
      if (args.title !== undefined && args.title !== null) {
        n.name = args.title;
      }
      if (args.bodyHtml !== undefined && args.bodyHtml !== null) {
        n.body = args.bodyHtml;
      }
      return noteMeta(n);
    }
  `,
    { id: opts.id, title: opts.title ?? null, bodyHtml: html ?? null },
  );
}

function clampLimit(value: number | undefined, defaultLimit: number, max: number): number {
  if (value === undefined) return defaultLimit;
  if (!Number.isFinite(value) || value < 1) return defaultLimit;
  return Math.min(Math.floor(value), max);
}
