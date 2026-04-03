/**
 * Find the nearest manualSortKey neighbors around a given index in a reordered list.
 *
 * Tasks without a manualSortKey haven't been manually sorted yet — skipping them
 * avoids sending equal or invalid key pairs to `generateKeyBetween`.
 *
 * When the visual order (dueDate/createdAt) doesn't match key order (mixed manual
 * and auto-sorted tasks), the found keys can be inverted (beforeKey >= afterKey).
 * In that case we keep only beforeKey — placing the item after it — because
 * the "above" neighbor is the stronger positional anchor.
 */
export function findNeighborKeys(
  items: Array<{ manualSortKey?: string | null }>,
  targetIndex: number,
): { beforeKey: string | undefined; afterKey: string | undefined } {
  let beforeKey: string | undefined
  for (let i = targetIndex - 1; i >= 0; i--) {
    if (items[i].manualSortKey) {
      beforeKey = items[i].manualSortKey!
      break
    }
  }

  let afterKey: string | undefined
  for (let i = targetIndex + 1; i < items.length; i++) {
    if (items[i].manualSortKey) {
      afterKey = items[i].manualSortKey!
      break
    }
  }

  // If keys are inverted (visual order ≠ key order), drop afterKey.
  // generateKeyBetween requires beforeKey < afterKey.
  if (beforeKey && afterKey && beforeKey >= afterKey) {
    afterKey = undefined
  }

  return { beforeKey, afterKey }
}
