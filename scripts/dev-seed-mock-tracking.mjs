import { PrismaClient, CourierProvider, MegaskaOrderStatus } from "../generated/prisma/index.js";

const prisma = new PrismaClient();

const ALLOWED_STATUSES = [
  MegaskaOrderStatus.ORDER_CONFIRMED,
  MegaskaOrderStatus.PACKED,
  MegaskaOrderStatus.PICKED_UP,
  MegaskaOrderStatus.IN_TRANSIT,
  MegaskaOrderStatus.OUT_FOR_DELIVERY,
];

function parseOrderNames(raw) {
  return String(raw || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to create mock tracking data in production.");
  }

  if (String(process.env.ALLOW_MOCK_TRACKING_SEED || "").toLowerCase() !== "true") {
    throw new Error("Set ALLOW_MOCK_TRACKING_SEED=true to run this development-only script.");
  }

  const orderNames = parseOrderNames(process.env.ORDER_NAMES);
  if (!orderNames.length) {
    throw new Error("Provide ORDER_NAMES as comma-separated Shopify order names (example: '#1001,#1002').");
  }

  const orders = await prisma.megaskaOrder.findMany({
    where: { shopifyOrderName: { in: orderNames } },
    select: { id: true, shopifyOrderName: true, status: true },
  });

  if (!orders.length) {
    throw new Error("No matching MegaskaOrder records found for ORDER_NAMES.");
  }

  for (const order of orders) {
    const now = Date.now();
    const shipment = await prisma.orderShipment.upsert({
      where: {
        id: `mock-${order.id}`,
      },
      create: {
        id: `mock-${order.id}`,
        orderId: order.id,
        provider: CourierProvider.OTHER,
        providerReference: `MOCK-REF-${order.shopifyOrderName}`,
        awb: `MOCK-AWB-${order.shopifyOrderName.replace(/[^A-Za-z0-9]/g, "")}`,
        trackingUrl: null,
        normalizedStatus: MegaskaOrderStatus.OUT_FOR_DELIVERY,
        statusUpdatedAt: new Date(now - 15 * 60 * 1000),
        rawStatus: "MOCK_OUT_FOR_DELIVERY",
        metadata: { mock: true, testData: true, source: "dev-seed-script" },
      },
      update: {
        provider: CourierProvider.OTHER,
        normalizedStatus: MegaskaOrderStatus.OUT_FOR_DELIVERY,
        statusUpdatedAt: new Date(now - 15 * 60 * 1000),
        rawStatus: "MOCK_OUT_FOR_DELIVERY",
        metadata: { mock: true, testData: true, source: "dev-seed-script", refreshedAt: new Date().toISOString() },
      },
    });

    await prisma.orderShipmentEvent.deleteMany({ where: { shipmentId: shipment.id } });

    const events = ALLOWED_STATUSES.map((status, index) => ({
      shipmentId: shipment.id,
      occurredAt: new Date(now - (ALLOWED_STATUSES.length - index) * 60 * 60 * 1000),
      normalizedStatus: status,
      rawStatus: `MOCK_${status}`,
      description: `[MOCK] ${status.replaceAll("_", " ")}`,
      location: "Test Hub",
      metadata: { mock: true, testData: true, source: "dev-seed-script" },
    }));

    await prisma.orderShipmentEvent.createMany({ data: events });

    await prisma.megaskaOrder.update({
      where: { id: order.id },
      data: {
        status: MegaskaOrderStatus.OUT_FOR_DELIVERY,
        statusSource: "mock-test-seed",
        statusUpdatedAt: new Date(now - 15 * 60 * 1000),
      },
    });

    console.log(`Seeded mock tracking for ${order.shopifyOrderName}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
