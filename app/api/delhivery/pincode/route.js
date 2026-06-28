import { NextResponse } from "next/server";

function withCors(response) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");
  return response;
}

export async function OPTIONS() {
  return withCors(NextResponse.json({ ok: true }, { status: 200 }));
}

function normalizePin(value) {
  return String(value || "").trim();
}

async function readPin(req) {
  const { searchParams } = new URL(req.url);
  if (searchParams.has("pincode")) return normalizePin(searchParams.get("pincode"));
  if (searchParams.has("pin")) return normalizePin(searchParams.get("pin"));

  if (req.method === "POST") {
    try {
      const body = await req.json();
      return normalizePin(body?.pincode || body?.pin);
    } catch (_error) {
      return "";
    }
  }

  return "";
}

async function handlePincode(req) {
  const pin = await readPin(req);

  if (!/^\d{6}$/.test(pin)) {
    return withCors(
      NextResponse.json(
        { ok: false, error: "Invalid pincode" },
        { status: 400 }
      )
    );
  }

  try {
    const token = (process.env.DELHIVERY_API_TOKEN || "").trim();
    const baseUrl =
      process.env.DELHIVERY_PINCODE_URL ||
      "https://track.delhivery.com/c/api/pin-codes/json/?filter_codes=pin_code";
    const originPin = process.env.DELHIVERY_ORIGIN_PIN;
    const tatBaseUrl =
      process.env.DELHIVERY_TAT_URL ||
      "https://track.delhivery.com/api/dc/expected_tat";

    if (!token) {
      return withCors(
        NextResponse.json(
          { ok: false, error: "Delhivery token not configured" },
          { status: 500 }
        )
      );
    }

    const svcUrl = new URL(baseUrl);
    svcUrl.searchParams.set("token", token);
    svcUrl.searchParams.set("filter_codes", pin);

    const dlRes = await fetch(svcUrl.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Token ${token}`,
      },
      cache: "no-store",
    });

    const svcText = await dlRes.text();

    if (!dlRes.ok) {
      return withCors(
        NextResponse.json(
          {
            ok: false,
            error: `Delhivery HTTP ${dlRes.status}`,
            debug: {
              contentType: dlRes.headers.get("content-type") || "",
              bodyPreview: svcText.slice(0, 300),
            },
          },
          { status: 502 }
        )
      );
    }

    let raw;
    try {
      raw = JSON.parse(svcText);
    } catch (_e) {
      return withCors(
        NextResponse.json(
          {
            ok: false,
            error: "Unexpected response from Delhivery",
            debug: {
              bodyPreview: svcText.slice(0, 300),
            },
          },
          { status: 502 }
        )
      );
    }

    const codes = raw.delivery_codes || [];
    const postal = codes[0]?.postal_code || {};

    const isServiceable = codes.length > 0;
    const isCod = postal.cod === "Y" || postal.cash === "Y";
    const isPrepaid = postal.pre_paid === "Y";

    const city = postal.city || null;
    const district = postal.district || city || null;
    const stateCode = postal.state_code || null;
    const inc = postal.inc || null;

    if (!isServiceable) {
      return withCors(
        NextResponse.json({
          ok: true,
          pin,
          isServiceable: false,
          isCod,
          isPrepaid,
          city,
          district,
          stateCode,
          inc,
          tatDays: null,
          estimatedDate: null,
        })
      );
    }

    let tatDays = null;
    let estimatedDate = null;

    try {
      if (tatBaseUrl && originPin) {
        const mot = "E";
        const pdt = "B2C";

        const tatUrl =
          tatBaseUrl +
          `?origin_pin=${encodeURIComponent(originPin)}` +
          `&destination_pin=${encodeURIComponent(pin)}` +
          `&mot=${encodeURIComponent(mot)}` +
          `&pdt=${encodeURIComponent(pdt)}`;

        const tatRes = await fetch(tatUrl, {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Token ${token}`,
          },
          cache: "no-store",
        });

        const tatText = await tatRes.text();
        let tatJson = null;

        try {
          tatJson = JSON.parse(tatText);
        } catch (_e) {}

        if (tatJson) {
          tatDays =
            tatJson.tat ||
            tatJson.days ||
            tatJson.expected_tat ||
            tatJson.tat_days ||
            (tatJson.data && (tatJson.data.tat || tatJson.data.expected_tat)) ||
            null;

          estimatedDate =
            tatJson.expected_delivery_date ||
            tatJson.delivery_date ||
            (tatJson.data &&
              (tatJson.data.expected_delivery_date ||
                tatJson.data.delivery_date)) ||
            null;

          if (tatDays && !estimatedDate) {
            const d = new Date();
            d.setDate(d.getDate() + Number(tatDays));
            estimatedDate = d.toISOString().slice(0, 10);
          }
        }
      }
    } catch (tatErr) {
      console.error("[DELHIVERY TAT ERROR]", tatErr);
    }

    return withCors(
      NextResponse.json({
        ok: true,
        pin,
        isServiceable,
        isCod,
        isPrepaid,
        city,
        district,
        stateCode,
        inc,
        tatDays: tatDays != null ? Number(tatDays) : null,
        estimatedDate,
      })
    );
  } catch (error) {
    console.error("[DELHIVERY PINCODE ERROR]", error);
    return withCors(
      NextResponse.json(
        { ok: false, error: "Failed to fetch serviceability" },
        { status: 500 }
      )
    );
  }
}

export async function GET(req) {
  return handlePincode(req);
}

export async function POST(req) {
  return handlePincode(req);
}
