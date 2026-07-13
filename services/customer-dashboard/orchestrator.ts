import type { CustomerDashboardDtoV1, DashboardModulesDto } from "./contract.ts";
import type { DashboardOrderRequestAggregation } from "./requests.ts";
import type { DashboardCommerceSnapshot } from "./commerce.ts";
import type { DashboardCustomerIdentity } from "./customer.ts";
import type { CustomerDashboardContext } from "./context.ts";
import { CustomerDashboardError } from "./errors.ts";

export type CustomerDashboardDependencies = {
  loadCustomer: (context: CustomerDashboardContext) => Promise<DashboardCustomerIdentity>;
  loadCommerce: (input: { context: CustomerDashboardContext; customer: DashboardCustomerIdentity }) => Promise<DashboardCommerceSnapshot>;
  loadRequests: (input: { context: CustomerDashboardContext; orderNumbers: string[] }) => Promise<DashboardOrderRequestAggregation>;
  loadTracking: (context: CustomerDashboardContext) => Promise<unknown>;
  loadWallet: (context: CustomerDashboardContext) => Promise<unknown>;
  loadModules: (context: CustomerDashboardContext) => Promise<DashboardModulesDto>;
};

export async function getCustomerDashboardV1(context: CustomerDashboardContext): Promise<CustomerDashboardDtoV1> {
  void context;
  throw new CustomerDashboardError({ code: "DASHBOARD_UNAVAILABLE", message: "Customer dashboard V1 is not wired yet.", status: 503, retryable: true });
}
