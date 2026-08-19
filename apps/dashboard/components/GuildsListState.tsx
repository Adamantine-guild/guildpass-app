import React from "react";
import EmptyState from "./EmptyState";
import ErrorState from "./ErrorState";
import LoadingSkeleton from "./LoadingSkeleton";

export type GuildsListStatus = "loading" | "loaded" | "unsupported" | "error";

type GuildsListStateProps = {
  status: GuildsListStatus;
  isEmpty: boolean;
  canWrite: boolean;
};

export default function GuildsListState({
  status,
  isEmpty,
  canWrite,
}: GuildsListStateProps) {
  if (status === "loading") {
    return <LoadingSkeleton label="Loading guilds" />;
  }

  if (status === "error") {
    return (
      <ErrorState
        title="Unable to load guilds"
        message="Failed to load guilds from the server. Check your API configuration and try again."
        icon="G"
      />
    );
  }

  if (status === "loaded" && isEmpty) {
    return (
      <EmptyState
        title="No guilds yet"
        description={
          canWrite
            ? "Create your first guild to get started."
            : "Guilds will appear here once they're created."
        }
        icon="G"
      />
    );
  }

  return null;
}
