import React from "react";
import EmptyState from "./EmptyState";
import ErrorState from "./ErrorState";
import LoadingSkeleton from "./LoadingSkeleton";

export type IntegrationsListStatus = "loading" | "loaded" | "error";

type IntegrationsListStateProps = {
  status: IntegrationsListStatus;
  isEmpty?: boolean;
};

export default function IntegrationsListState({
  status,
  isEmpty = false,
}: IntegrationsListStateProps) {
  if (status === "loading") {
    return <LoadingSkeleton count={2} label="Loading integrations" />;
  }

  if (status === "error") {
    return (
      <ErrorState
        title="Unable to load integrations"
        message="Failed to load integrations from the server. Check your configuration and try again."
        icon="I"
      />
    );
  }

  if (status === "loaded" && isEmpty) {
    return (
      <EmptyState
        title="No integrations configured"
        description="Integrations will appear here when they are available for this workspace."
        icon="I"
      />
    );
  }

  return null;
}
