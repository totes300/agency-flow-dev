/**
 * Browser file-download helpers. Shared by every surface that hands the user
 * a generated file (worksheet exports, agent CSV artifacts) so the transient
 * Object-URL dance lives in exactly one place.
 */

/**
 * Trigger a download for a UTF-8 CSV string. Uses a transient Object URL so
 * the file streams from memory instead of staying live for the page
 * lifetime. The BOM (Excel-on-Windows) is expected to already be embedded by
 * the caller; the `charset=utf-8` hint makes accents render reliably.
 */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  // Some browsers (Safari) require the anchor to be in the document to
  // dispatch the click reliably.
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  // Revoke after the click so the browser has a chance to read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
