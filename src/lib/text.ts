// Strips HTML and truncates on a word boundary -- used to auto-derive a
// short preview when an article is saved without one. Mirrors the frontend's
// own plainTextExcerpt (src/lib/format.ts) so previews look the same whether
// shown via the metadata fallback or an admin-left-blank excerpt field.
export function plainTextExcerpt(html: string, maxLength = 160): string {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  return `${truncated.slice(0, lastSpace > 0 ? lastSpace : maxLength)}…`;
}
