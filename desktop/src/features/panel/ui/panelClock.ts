/**
 * The UTC clock the panel prints for an instant, as design §2.4 fixes for the
 * cell's provenance line («de las [HH:MM] UTC») and §1 for the section notice
 * («Lectura fallida a las `<HH:MM>` UTC»). Both read one hour, so both print it
 * one way: the raw ISO belongs to the `Instante` cell, never to a sentence. An
 * instant the platform cannot parse names no hour rather than inventing one.
 */
export function clockUtc(iso: string | null): string | null {
  if (iso === null) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const hour = String(at.getUTCHours()).padStart(2, "0");
  const minute = String(at.getUTCMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}
