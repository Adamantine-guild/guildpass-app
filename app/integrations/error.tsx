"use client";

import DashboardLayout from "@/components/DashboardLayout";
import IntegrationsListState from "@/components/IntegrationsListState";

export default function IntegrationsError() {
  return (
    <DashboardLayout title="Integrations">
      <div className="max-w-4xl">
        <IntegrationsListState status="error" />
      </div>
    </DashboardLayout>
  );
}
