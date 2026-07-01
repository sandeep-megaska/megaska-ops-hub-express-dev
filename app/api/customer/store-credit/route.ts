import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../_lib/cors";
import { getAuthenticatedExchangeCustomer } from "../../../../services/exchange/auth";
import { getCustomerStoreCreditBalance } from "../../../../services/store-credit";

export const runtime = "nodejs";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthenticatedExchangeCustomer(req);
    if (!auth) {
      return withCors(req, NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    }

    const data = await getCustomerStoreCreditBalance({
      shopId: auth.shop.id,
      customerProfileId: auth.session.customer.id,
      currency: "INR",
    });

    return withCors(req, NextResponse.json(data));
  } catch (error) {
    console.error("[STORE CREDIT] customer_balance_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return withCors(req, NextResponse.json({ error: "Unable to load Megaska Store Credit." }, { status: 500 }));
  }
}
