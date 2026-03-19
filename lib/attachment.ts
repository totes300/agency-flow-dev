/**
 * Pure utility functions for attachments.
 */

export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
export const MAX_FILES_PER_TASK = 20

export const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
])

/**
 * Validate a file before upload.
 * Returns an error message or null if valid.
 */
export function validateFile(
  file: { size: number; type: string; name: string },
  existingCount: number,
): string | null {
  if (existingCount >= MAX_FILES_PER_TASK) {
    return `Maximum ${MAX_FILES_PER_TASK} files per task`
  }
  if (file.size > MAX_FILE_SIZE) {
    return `File "${file.name}" exceeds 10MB limit`
  }
  if (file.size === 0) {
    return `File "${file.name}" is empty`
  }
  return null
}

/**
 * Check if a MIME type is a previewable image.
 */
export function isImageType(mimeType: string): boolean {
  return ALLOWED_IMAGE_TYPES.has(mimeType)
}

/**
 * Get a human-readable file size string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Extract file extension from a filename.
 */
export function getFileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".")
  if (dot === -1 || dot === fileName.length - 1) return ""
  return fileName.slice(dot + 1).toLowerCase()
}
