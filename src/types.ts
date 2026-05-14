export type Folder = {
  id: string;
  name: string;
  account: string;
};

export type Account = {
  name: string;
  folders: Folder[];
};

export type NoteMeta = {
  id: string;
  name: string;
  folder: string;
  account: string;
  createdAt: string;
  modifiedAt: string;
};

export type Note = NoteMeta & {
  bodyHtml: string;
  bodyText: string;
};

export type FolderRef =
  | { folderId: string }
  | { account?: string; folderName?: string };

export type BodyFormat = "text" | "html";
