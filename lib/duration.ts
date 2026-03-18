/**
 * Parse a human-friendly duration string into minutes.
 *
 * Supported formats:
 *   "30m"     → 30
 *   "2h"      → 120
 *   "1h 30m"  → 90
 *   "1h30m"   → 90
 *   "1:30"    → 90
 *   "1.5"     → 90  (decimal hours)
 *   "90"      → 90  (plain minutes)
 *
 * Returns null for unparseable or zero/negative values.
 */
export function parseDuration(input: string): number | null {
  const s = input.trim();
  if (!s) return null;

  // "1h 30m" or "1h30m" or "2h" or "45m"
  const hmMatch = s.match(/^(\d+)\s*h\s*(?:(\d+)\s*m)?$/i);
  if (hmMatch) {
    const hours = parseInt(hmMatch[1], 10);
    const mins = hmMatch[2] ? parseInt(hmMatch[2], 10) : 0;
    const total = hours * 60 + mins;
    return total > 0 ? total : null;
  }

  // "30m" (minutes only, no hours component)
  const mOnly = s.match(/^(\d+)\s*m$/i);
  if (mOnly) {
    const mins = parseInt(mOnly[1], 10);
    return mins > 0 ? mins : null;
  }

  // "1:30" (HH:MM colon format)
  const colonMatch = s.match(/^(\d+):(\d{1,2})$/);
  if (colonMatch) {
    const hours = parseInt(colonMatch[1], 10);
    const mins = parseInt(colonMatch[2], 10);
    if (mins >= 60) return null;
    const total = hours * 60 + mins;
    return total > 0 ? total : null;
  }

  // Numeric: "1.5" (decimal hours) or "90" (plain minutes)
  const num = parseFloat(s);
  if (isNaN(num) || num <= 0) return null;

  // If it contains a dot, interpret as decimal hours
  if (s.includes(".")) {
    return Math.round(num * 60);
  }

  // Plain integer → minutes
  return Math.round(num);
}

/**
 * Format minutes into a human-readable duration string.
 * Examples: 0→"0m", 30→"30m", 60→"1h", 90→"1h 30m", 480→"8h"
 */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return "0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Quick duration presets for time entry forms */
export const QUICK_DURATIONS = [
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "2h", minutes: 120 },
  { label: "4h", minutes: 240 },
  { label: "8h", minutes: 480 },
] as const;

/**
 * Format milliseconds as a live timer display: "HH:MM:SS"
 * Examples: 0→"00:00:00", 3661000→"01:01:01"
 */
export function formatTimerDisplay(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
