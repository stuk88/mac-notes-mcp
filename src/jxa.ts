import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PERMISSION_HINT =
  "Grant access in System Settings → Privacy & Security → Automation → enable Notes for your terminal or Claude Code.";

export class JxaError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly stderr?: string,
  ) {
    super(message);
    this.name = "JxaError";
  }
}

export async function runJxa<T>(scriptBody: string, args: unknown = {}): Promise<T> {
  const wrapper = `
    ${scriptBody}
    function run(argv) {
      try {
        var args = JSON.parse(argv[0] || "{}");
        var result = main(args);
        return JSON.stringify({ ok: true, value: result === undefined ? null : result });
      } catch (e) {
        var msg = String(e && e.message ? e.message : e);
        var code = (e && typeof e.errorNumber === "number") ? e.errorNumber : null;
        return JSON.stringify({ ok: false, error: msg, errorNumber: code });
      }
    }
  `;

  let stdout: string;
  try {
    const out = await execFileAsync(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", wrapper, JSON.stringify(args)],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    stdout = out.stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      throw new JxaError(
        "Notes response exceeded the 32MB buffer. Narrow the result with `limit` or a folder filter.",
        "OUTPUT_TOO_LARGE",
      );
    }
    const stderr = e.stderr ?? "";
    if (/not authorized|not allowed/i.test(stderr) || stderr.includes("-1743")) {
      throw new JxaError(
        `Not authorized to control Notes. ${PERMISSION_HINT}`,
        "PERMISSION_DENIED",
        stderr,
      );
    }
    if (
      /application can't be found|application isn't running/i.test(stderr) ||
      stderr.includes("-1719") ||
      stderr.includes("-600")
    ) {
      throw new JxaError(
        "Notes application not reachable. Make sure Notes is installed and able to launch.",
        "APP_NOT_FOUND",
        stderr,
      );
    }
    throw new JxaError(
      `osascript failed: ${stderr || e.message}`,
      "OSASCRIPT_FAILED",
      stderr,
    );
  }

  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new JxaError("osascript returned no output", "EMPTY_OUTPUT");
  }

  let parsed:
    | { ok: true; value: T }
    | { ok: false; error: string; errorNumber: number | null };
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new JxaError(`osascript returned non-JSON output: ${trimmed.slice(0, 200)}`, "BAD_OUTPUT");
  }

  if (!parsed.ok) {
    if (parsed.errorNumber === -1728 || /Can't get object/.test(parsed.error)) {
      throw new JxaError(`Not found: ${parsed.error}`, "NOT_FOUND");
    }
    if (parsed.errorNumber === -1743 || /not authorized|not allowed/i.test(parsed.error)) {
      throw new JxaError(
        `Not authorized to control Notes. ${PERMISSION_HINT}`,
        "PERMISSION_DENIED",
      );
    }
    throw new JxaError(parsed.error, "SCRIPT_ERROR");
  }
  return parsed.value;
}
