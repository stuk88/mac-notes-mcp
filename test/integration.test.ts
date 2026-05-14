import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  appendToNote,
  createNote,
  listAccounts,
  listFolders,
  listNotes,
  readNote,
  searchNotes,
  updateNote,
} from "../src/notes.ts";
import { createFolder, deleteFolder } from "../src/test-helpers.ts";
import { htmlToText, textToHtml } from "../src/html.ts";

const SUITE_ID = randomUUID().slice(0, 8);
const FOLDER_NAME = `mcp-test-${SUITE_ID}`;
// Unique substring planted in note bodies so search assertions are deterministic.
const MAGIC = `magic-${SUITE_ID}`;

let folderId: string;
let createdNoteId: string;

describe("html helpers", () => {
  it("round-trips plain text through textToHtml -> htmlToText", () => {
    const text = "line one\nline two\n\nline four";
    const html = textToHtml(text);
    assert.match(html, /<div>line one<\/div>/);
    assert.match(html, /<div><br><\/div>/);
    const back = htmlToText(html);
    assert.equal(back, text);
  });

  it("escapes HTML-significant chars in textToHtml", () => {
    const html = textToHtml("<script>&");
    assert.match(html, /&lt;script&gt;&amp;/);
    assert.doesNotMatch(html, /<script>/);
  });

  it("decodes numeric and hex entities in htmlToText", () => {
    assert.equal(htmlToText("&#65;&#x42;"), "AB");
  });
});

describe("mac-notes adapter (integration)", () => {
  before(async () => {
    const folder = await createFolder({ name: FOLDER_NAME });
    folderId = folder.id;
    assert.ok(folderId, "createFolder must return an id");
    assert.equal(folder.name, FOLDER_NAME);
  });

  after(async () => {
    if (folderId) {
      try {
        await deleteFolder(folderId);
      } catch (err) {
        console.error("cleanup failed:", err);
      }
    }
  });

  it("listAccounts includes the account that owns the test folder", async () => {
    const accounts = await listAccounts();
    assert.ok(accounts.length > 0, "should have at least one account");
    const owning = accounts.find((a) => a.folders.some((f) => f.id === folderId));
    assert.ok(owning, `account containing folder ${folderId} should be discoverable`);
  });

  it("listFolders includes the freshly created folder", async () => {
    const folders = await listFolders();
    const match = folders.find((f) => f.id === folderId);
    assert.ok(match, `expected folder ${FOLDER_NAME} in listFolders output`);
    assert.equal(match?.name, FOLDER_NAME);
  });

  it("createNote returns metadata pointing at the new note", async () => {
    const note = await createNote({
      folderId,
      title: `Hello ${SUITE_ID}`,
      body: `first line ${MAGIC}\nsecond line`,
    });
    createdNoteId = note.id;
    assert.ok(note.id, "createNote must return an id");
    assert.equal(note.folder, FOLDER_NAME);
    assert.match(note.account, /.+/);
  });

  it("listNotes(folderId) returns the new note", async () => {
    const notes = await listNotes({ folderId, limit: 50 });
    const match = notes.find((n) => n.id === createdNoteId);
    assert.ok(match, "created note should appear in listNotes for the folder");
  });

  it("readNote returns body in both HTML and plain text", async () => {
    const note = await readNote(createdNoteId);
    assert.match(note.bodyHtml, /<div>/);
    assert.match(note.bodyText, new RegExp(MAGIC));
    assert.match(note.bodyText, /second line/);
  });

  it("searchNotes finds the unique magic substring", async () => {
    const hits = await searchNotes({ query: MAGIC, scope: "body", limit: 10 });
    assert.ok(
      hits.some((h) => h.id === createdNoteId),
      `searchNotes for ${MAGIC} should find note ${createdNoteId}`,
    );
  });

  it("searchNotes does not match raw HTML tag names", async () => {
    const hits = await searchNotes({
      query: "<div",
      scope: "body",
      folderId,
      limit: 50,
    });
    assert.equal(
      hits.length,
      0,
      "search should ignore HTML markup so <div doesn't return every note",
    );
  });

  it("appendToNote extends the body and bumps modifiedAt", async () => {
    const before = await readNote(createdNoteId);
    const appended = `appended-${SUITE_ID}`;
    await appendToNote({ id: createdNoteId, body: appended, separator: "\n" });
    const after = await readNote(createdNoteId);
    assert.ok(after.bodyText.includes(appended), "appended text must appear in body");
    assert.ok(after.bodyText.includes(MAGIC), "original body must be preserved");
    assert.ok(
      new Date(after.modifiedAt).getTime() >= new Date(before.modifiedAt).getTime(),
      "modifiedAt should not go backwards after an append",
    );
  });

  it("updateNote replaces title and body when provided", async () => {
    const newTitle = `Updated ${SUITE_ID}`;
    const newBody = `wholly new body ${MAGIC}-v2`;
    await updateNote({ id: createdNoteId, title: newTitle, body: newBody });
    const refreshed = await readNote(createdNoteId);
    assert.equal(refreshed.name, newTitle);
    assert.match(refreshed.bodyText, new RegExp(`${MAGIC}-v2`));
    assert.doesNotMatch(
      refreshed.bodyText,
      /appended-/,
      "update_note must replace the body, not append",
    );
  });
});
