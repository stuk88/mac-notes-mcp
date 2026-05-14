// Helpers used only by the integration test suite. Not exposed as MCP tools.
// Delete operations live here intentionally so they cannot be triggered by an
// LLM through the public tool surface.
import { runJxa } from "./jxa.js";
export async function createFolder(opts) {
    return runJxa(`
    function main(args) {
      var Notes = Application("Notes");
      var account = args.account
        ? Notes.accounts.byName(args.account)
        : Notes.defaultAccount();
      var folder = Notes.Folder({ name: args.name });
      account.folders.push(folder);
      return { id: folder.id(), name: folder.name(), account: account.name() };
    }
  `, opts);
}
export async function deleteFolder(folderId) {
    await runJxa(`
    function main(args) {
      var Notes = Application("Notes");
      var f = Notes.folders.byId(args.folderId);
      Notes.delete(f);
      return null;
    }
  `, { folderId });
}
export async function deleteNote(noteId) {
    await runJxa(`
    function main(args) {
      var Notes = Application("Notes");
      var n = Notes.notes.byId(args.noteId);
      Notes.delete(n);
      return null;
    }
  `, { noteId });
}
//# sourceMappingURL=test-helpers.js.map