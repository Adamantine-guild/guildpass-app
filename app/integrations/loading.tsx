import DashboardLayout from "@/components/DashboardLayout";
import IntegrationsListState from "@/components/IntegrationsListState";

export default function IntegrationsLoading() {
  return (
    <DashboardLayout title="Integrations">
      <div className="max-w-4xl">
        <IntegrationsListState status="loading" />
      </div>
    </DashboardLayout>
  );
}
