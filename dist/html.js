export function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
export function textToHtml(text) {
    return text
        .split("\n")
        .map((line) => (line === "" ? "<div><br></div>" : `<div>${escapeHtml(line)}</div>`))
        .join("");
}
export function htmlToText(html) {
    return html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(div|p|li|h[1-6])>/gi, "\n")
        .replace(/<li[^>]*>/gi, "• ")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
// Used when comparing user queries against note bodies — collapses tags and
// common entities so a search for "foo" doesn't have to step around <div> noise.
export function stripHtmlForSearch(html) {
    return html
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ");
}
export function normalizeBody(input, format) {
    return format === "html" ? input : textToHtml(input);
}
//# sourceMappingURL=html.js.map