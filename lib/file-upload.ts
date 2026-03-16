export const MAX_LOGO_FILE_SIZE = 2 * 1024 * 1024 // 2MB
export const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml"]

export function validateLogoFile(file: File): string | null {
  if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
    return "Please upload a PNG, JPG, or SVG file"
  }
  if (file.size > MAX_LOGO_FILE_SIZE) {
    return "File must be smaller than 2MB"
  }
  return null
}
