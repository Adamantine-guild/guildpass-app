import DashboardLayout from "@/components/DashboardLayout";
import IntegrationsListState, {
  type IntegrationsListStatus,
} from "@/components/IntegrationsListState";
import { getServerComponentSession } from "@/lib/auth/server-session";
import { getIntegrationsList } from "@/lib/integrations";
import type { IntegrationDetails, IntegrationStatus } from "@/lib/integrations";
import AccessDenied from "@/components/AccessDenied";
import ReconcilePanel from "@/components/ReconcilePanel";
import { hasRole } from "@/lib/permissions";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { getApiMode } from "@/lib/env";

const StatusBadge = ({ status }: { status: IntegrationStatus }) => {
  const styles: Record<IntegrationStatus, string> = {
    healthy: "bg-emerald-100 text-emerald-800 border-emerald-200",
    configured: "bg-blue-100 text-blue-800 border-blue-200",
    unhealthy: "bg-red-100 text-red-800 border-red-200",
    disabled: "bg-slate-100 text-slate-800 border-slate-200",
    unknown: "bg-amber-100 text-amber-800 border-amber-200"
  };

  const labels: Record<IntegrationStatus, string> = {
    healthy: "Healthy",
    configured: "Configured (Mock)",
    unhealthy: "Unhealthy",
    disabled: "Disabled",
    unknown: "Unknown"
  };

  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${styles[status]}`}>
      {labels[status]}
    </span>
  );
};

type IntegrationsPageProps = {
  searchParams?: {
    mockState?: string | string[];
  };
};

export default async function IntegrationsPage({
  searchParams,
}: IntegrationsPageProps) {
  // 1. Fetch the actual session dynamically instead of using the hardcoded mock
  const session = await getServerComponentSession();

  // 2. Enforce the hard boundary: only Owners and Admins can view integrations
  const canAccessIntegrations = hasRole(session, session.activeGuildId, ["owner", "admin"]);

  if (!canAccessIntegrations) {
    return (
      <DashboardLayout title="Integrations" session={session}>
        <AccessDenied requiredPermission="Role: owner or admin" currentRole={session.role} />
      </DashboardLayout>
    );
  }

  // 3. Authorized users proceed to load the data
  let integrations: IntegrationDetails[] = [];
  let listState: IntegrationsListStatus = "loaded";

  try {
    const requestedMockState = Array.isArray(searchParams?.mockState)
      ? searchParams.mockState[0]
      : searchParams?.mockState;
    const mockState = getApiMode() === "mock" ? requestedMockState : undefined;

    if (mockState === "error") {
      throw new Error("Simulated integrations fetch error");
    }

    integrations =
      mockState === "empty" ? [] : await getIntegrationsList();
  } catch (error) {
    console.warn("Failed to load integrations:", error);
    listState = "error";
  }

  return (
    <DashboardLayout title="Integrations" session={session}>
      <div className="max-w-4xl">
        <div className="mb-8">
          <p className="text-slate-600">
            Manage optional third-party integrations and internal services for your GuildPass workspace.
          </p>
        </div>

        <div className="space-y-6">
          <ReconcilePanel />
          <IntegrationsListState
            status={listState}
            isEmpty={integrations.length === 0}
          />
          {listState === "loaded" && integrations.map((integration) => (
            <div key={integration.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-slate-900">{integration.name}</h3>
                      {integration.optional && (
                        <span className="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded border border-slate-200">
                          Optional
                        </span>
                      )}
                      <StatusBadge status={integration.status} />
                    </div>
                    <p className="text-slate-600 text-sm mb-4">{integration.description}</p>

                    <div className="bg-slate-50 rounded-lg p-4 text-sm border border-slate-100">
                      <p className="font-medium text-slate-800 mb-1">Status Details</p>
                      <p className="text-slate-600">{integration.message}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
                <span>Adapter Strategy: {integration.details?.strategy || integration.details?.mode || "N/A"}</span>
                {integration.lastChecked && (
                  <span>Last Checked: {formatRelativeTime(integration.lastChecked)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
