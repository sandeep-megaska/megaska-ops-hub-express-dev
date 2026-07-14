import type { NextRequest } from "next/server";
import { CustomerDashboardError, resolveCustomerDashboardContext } from "../index.ts";
import { CustomerDashboardActionError } from "./errors.ts";
export type CustomerDashboardActionContext = { shopId: string; shopDomain: string; customerProfileId: string; sessionId: string; now: Date };
export async function resolveCustomerDashboardActionContext(req: NextRequest): Promise<CustomerDashboardActionContext> { try { return await resolveCustomerDashboardContext(req); } catch (error) { if (error instanceof CustomerDashboardError) { if (error.code === "SESSION_REQUIRED" || error.code === "SESSION_EXPIRED") throw new CustomerDashboardActionError({ code: error.code, message: error.message, status: error.status, retryable: error.retryable }); throw new CustomerDashboardActionError({ code: "ACTION_FAILED", message: "We could not verify your dashboard session.", status: error.status, retryable: error.retryable, cause: error }); } throw error; } }
