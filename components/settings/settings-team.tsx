"use client"

import { OrganizationProfile } from "@clerk/nextjs"

export function SettingsTeam() {
  return (
    <OrganizationProfile
      routing="hash"
      appearance={{
        elements: {
          rootBox: "w-full",
          cardBox: "w-full shadow-none",
        },
      }}
    />
  )
}
