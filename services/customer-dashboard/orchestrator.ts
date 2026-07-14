import type { CustomerDashboardDtoV1, DashboardModulesDto } from "./contract.ts";
import type { CustomerDashboardContext } from "./context.ts";
import { CustomerDashboardError } from "./errors.ts";

export type CustomerDashboardDependencies = {
  loadCustomer: (context: CustomerDashboardContext) => Promise<unknown>;
  loadCommerce: (context: CustomerDashboardContext) => Promise<unknown>;
  loadRequests: (context: CustomerDashboardContext) => Promise<unknown>;
  loadTracking: (context: CustomerDashboardContext) => Promise<unknown>;
  loadWallet: (context: CustomerDashboardContext) => Promise<unknown>;
  loadModules: (context: CustomerDashboardContext) => Promise<DashboardModulesDto>;
};

export async function getCustomerDashboardV1(context: CustomerDashboardContext): Promise<CustomerDashboardDtoV1> {
  void context;
  throw new CustomerDashboardError({ code: "DASHBOARD_UNAVAILABLE", message: "Customer dashboard V1 is not wired yet.", status: 503, retryable: true });
}
