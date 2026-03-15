"use client";

import { ReactNode, useEffect } from "react";
import { ConvexReactClient, useConvexAuth, useMutation } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useAuth } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

function UserSync({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const syncUser = useMutation(api.users.syncUser);

  useEffect(() => {
    if (isAuthenticated) {
      syncUser().catch((error) => {
        console.error("Failed to sync user:", error);
      });
    }
  }, [isAuthenticated, syncUser]);

  return <>{children}</>;
}

export default function ConvexClientProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      <UserSync>{children}</UserSync>
    </ConvexProviderWithClerk>
  );
}
