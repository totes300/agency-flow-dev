"use client"

import { OrganizationProfile } from "@clerk/nextjs"

export default function SettingsPage() {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your organization, members, and roles.
        </p>
      </div>
      <OrganizationProfile
        routing="hash"
        appearance={{
          elements: {
            rootBox: "w-full",
            cardBox: "w-full shadow-none",
          },
        }}
      />
    </div>
  )
}
