"use client"

import { useOrganization, useOrganizationList, CreateOrganization } from "@clerk/nextjs"
import { useState } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { ChevronsUpDownIcon, PlusIcon, BuildingIcon, UserIcon } from "lucide-react"

export function TeamSwitcher() {
  const { isMobile } = useSidebar()
  const { organization } = useOrganization()
  const { userMemberships, setActive } = useOrganizationList({
    userMemberships: { infinite: true },
  })
  const [showCreate, setShowCreate] = useState(false)

  if (showCreate) {
    return (
      <div className="p-2">
        <CreateOrganization
          afterCreateOrganizationUrl="/dashboard"
          skipInvitationScreen
        />
        <button
          onClick={() => setShowCreate(false)}
          className="mt-2 w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    )
  }

  const activeName = organization?.name ?? "Personal Account"

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                {organization ? (
                  <BuildingIcon className="size-4" />
                ) : (
                  <UserIcon className="size-4" />
                )}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{activeName}</span>
                <span className="truncate text-xs">
                  {organization ? "Organization" : "Personal"}
                </span>
              </div>
              <ChevronsUpDownIcon className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Organizations
            </DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => setActive?.({ organization: null })}
              className="gap-2 p-2"
            >
              <div className="flex size-6 items-center justify-center rounded-md border">
                <UserIcon className="size-3.5" />
              </div>
              Personal Account
            </DropdownMenuItem>
            {userMemberships?.data?.map((mem) => (
              <DropdownMenuItem
                key={mem.organization.id}
                onClick={() =>
                  setActive?.({ organization: mem.organization.id })
                }
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-md border">
                  <BuildingIcon className="size-3.5" />
                </div>
                {mem.organization.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 p-2"
              onClick={() => setShowCreate(true)}
            >
              <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                <PlusIcon className="size-4" />
              </div>
              <div className="font-medium text-muted-foreground">
                Create Organization
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
