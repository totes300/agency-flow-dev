// ─── SVG brand icons for link previews and integrations ─────────────────────

type IconProps = { className?: string }

export function FigmaIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 38 57" fill="none">
      <path d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z" fill="#1ABCFE" />
      <path d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 1 1-19 0z" fill="#0ACF83" />
      <path d="M19 0v19h9.5a9.5 9.5 0 1 0 0-19H19z" fill="#FF7262" />
      <path d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5z" fill="#F24E1E" />
      <path d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5z" fill="#A259FF" />
    </svg>
  )
}

export function LoomIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <path d="M30.67 14.33h-7.39l6.4-3.69-1.67-2.9-6.4 3.7 3.7-6.4-2.9-1.67-3.7 6.4V2.33h-3.34v7.44l-3.69-6.4-2.9 1.67 3.7 6.4-6.4-3.7-1.67 2.9 6.4 3.7H2.33v3.33h7.44l-6.4 3.7 1.67 2.9 6.4-3.7-3.7 6.4 2.9 1.67 3.7-6.4v7.44h3.33v-7.44l3.7 6.4 2.9-1.67-3.7-6.4 6.4 3.7 1.67-2.9-6.4-3.7h7.44v-3.33zM16 20a4 4 0 1 1 0-8 4 4 0 0 1 0 8z" fill="#625DF5" />
    </svg>
  )
}

export function WebflowIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <path d="M23.6 10.8s-2.8 8.6-3 9.3c-.1-.7-1.5-9.3-1.5-9.3s-3.5 0-5.2 2.4c0 0-3 9.2-3.2 9.8-.1-.8-.9-7.5-.9-7.5C9.5 12.2 6 10.8 6 10.8l3.1 13.8s3.7.1 5.4-2.4l2.9-8.5 1.4 8.5s3.7.1 5.4-2.4L28.9 10.8h-5.3z" fill="#4353FF" />
    </svg>
  )
}

export function GoogleDriveIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 87.3 78" fill="none">
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5l5.4 9.35z" fill="#0066DA" />
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5l16.15-28z" fill="#00AC47" />
      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.85L53 62.95l6.55 13.85h14z" fill="#EA4335" />
      <path d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2L43.65 25z" fill="#00832D" />
      <path d="m59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2H69c1.6 0 3.15-.45 4.5-1.2L59.8 53z" fill="#2684FC" />
      <path d="M73.4 26.5 60.65 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.6 25l16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5l-12.6-22z" fill="#FFBA00" />
    </svg>
  )
}

export function GitHubIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5 1 .11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6.02 0c2.28-1.55 3.29-1.23 3.29-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.82.58A12.01 12.01 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}

export function NotionIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M4.46 4.04l10.09-.73c1.24-.1 1.56-.04 2.34.53l3.23 2.26c.53.38.7.49.7 1.08v12.03c0 .83-.3 1.33-1.38 1.4l-12.08.71c-.8.05-1.18-.08-1.6-.6L3.2 17.64c-.48-.63-.7-1.1-.7-1.66V5.42c0-.7.3-1.3 1.96-1.38zm10.44 1.96c0 .33-.04.38-.24.43l-1.44.28v10.5c-.44.24-.85.38-1.19.38-.55 0-.69-.17-1.09-.68L7.4 10.74v5.59l1.49.33s0 .43-.59.43l-1.62.1c-.05-.1 0-.34.17-.38l.42-.12V9.26L5.82 9.1c-.05-.1.03-.44.55-.47l1.74-.1 3.73 5.7V9.27l-1.24-.13c-.05-.15.09-.39.49-.42l1.62-.1z" />
    </svg>
  )
}

export function LinearIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M2.1 13.32a10.08 10.08 0 0 0 8.58 8.58L2.1 13.32zm-.86-2.2a10.12 10.12 0 0 0 11.64 11.64L1.24 11.12zm1.73-3.16L15.04 20.03A10.05 10.05 0 0 0 21.76 12 10.01 10.01 0 0 0 12 2.24a10.05 10.05 0 0 0-8.03 5.72z" fill="#5E6AD2" />
    </svg>
  )
}

export function LovableIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="#E11D48" />
    </svg>
  )
}

export function YouTubeIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.38.55A3.02 3.02 0 0 0 .5 6.19 31.56 31.56 0 0 0 0 12a31.56 31.56 0 0 0 .5 5.81 3.02 3.02 0 0 0 2.12 2.14c1.87.55 9.38.55 9.38.55s7.5 0 9.38-.55a3.02 3.02 0 0 0 2.12-2.14A31.56 31.56 0 0 0 24 12a31.56 31.56 0 0 0-.5-5.81zM9.55 15.57V8.43L15.82 12l-6.27 3.57z" fill="#FF0000" />
    </svg>
  )
}

// ─── Domain → icon mapping ──────────────────────────────────────────────────────

export type DomainConfig = {
  icon: React.ComponentType<{ className?: string }>
  label: string
}

export const DOMAIN_MAP: Record<string, DomainConfig> = {
  "figma.com":         { icon: FigmaIcon, label: "Figma" },
  "loom.com":          { icon: LoomIcon, label: "Loom" },
  "webflow.com":       { icon: WebflowIcon, label: "Webflow" },
  "webflow.io":        { icon: WebflowIcon, label: "Webflow" },
  "lovable.dev":       { icon: LovableIcon, label: "Lovable" },
  "github.com":        { icon: GitHubIcon, label: "GitHub" },
  "notion.so":         { icon: NotionIcon, label: "Notion" },
  "linear.app":        { icon: LinearIcon, label: "Linear" },
  "youtube.com":       { icon: YouTubeIcon, label: "YouTube" },
  "youtu.be":          { icon: YouTubeIcon, label: "YouTube" },
  "drive.google.com":  { icon: GoogleDriveIcon, label: "Google Drive" },
  "docs.google.com":   { icon: GoogleDriveIcon, label: "Google Docs" },
}

export function getDomainConfig(domain: string): DomainConfig | null {
  const clean = domain.replace(/^www\./, "")
  if (DOMAIN_MAP[clean]) return DOMAIN_MAP[clean]
  const parts = clean.split(".")
  if (parts.length > 2) {
    const parent = parts.slice(-2).join(".")
    if (DOMAIN_MAP[parent]) return DOMAIN_MAP[parent]
  }
  return null
}
