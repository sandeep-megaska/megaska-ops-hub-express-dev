export type Cta = { readonly label: string; readonly href: string };
export type Capability = {
  readonly title: string;
  readonly problem: string;
  readonly response: string;
  readonly labels: readonly string[];
  readonly href: string;
  readonly linkLabel: string;
  readonly status?: string;
};
export type FeatureSection = {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly cta: Cta;
  readonly items: readonly string[];
};

export const homepageConfig = {
  site: {
    name: "LoopDesk",
    title: "LoopDesk | Shopify Commerce Experience Platform",
    description:
      "LoopDesk connects cart, checkout, payments, customer self-service, merchant operations, post-purchase resolution, store credit, and repeat purchase for Shopify merchants.",
    url: "https://loopdesk.in",
  },
  hero: {
    eyebrow: "Built from real D2C operations",
    headline: "Commerce without the chaos.",
    description:
      "LoopDesk connects cart, checkout, payments, customer self-service, merchant operations, and post-purchase experiences in one Shopify commerce platform.",
    category: "Shopify Commerce Experience Platform",
    trust: "Developed under D2C Loop, a commerce technology initiative of BIGONBUY Trading Pvt Ltd.",
    primaryCta: { label: "Install LoopDesk", href: "/install" },
    secondaryCta: { label: "Explore the Platform", href: "/platform" },
    demoCta: { label: "Book a Demo", href: "/demo" },
  },
  problem: {
    eyebrow: "Fragmented commerce operations",
    title: "Merchants should not need a dozen disconnected workflows to serve one order.",
    description:
      "WhatsApp conversations, emails, phone calls, spreadsheets, manual bank refunds, separate GST tooling, support requests, and multiple Shopify apps can make routine commerce work harder to track.",
    before: ["Channel-heavy requests", "Manual refund follow-up", "Separate operational records", "Disconnected app handoffs"],
    after: ["Structured eligible workflows", "Central merchant workspace", "Policy-aware request tracking", "Connected customer journey"],
  },
  loop: {
    eyebrow: "The Commerce Loop",
    title: "A connected journey from first visit to repeat purchase.",
    description:
      "LoopDesk is structured around the complete commerce lifecycle, with OTP login at checkout and merchant operations connected after the order.",
    stages: [
      "Visitor", "Shopping", "Cart", "Smart Promotions", "Express Checkout", "OTP Login", "Address Prefill", "Store Credit, when available", "Payment", "Order", "Customer Dashboard", "Merchant Operations", "Exchange, Cancellation, or Issue Resolution", "Store Credit or Other Resolution", "Repeat Purchase", "Visitor Again",
    ],
  },
  platform: {
    eyebrow: "One Platform. Every Commerce Experience.",
    title: "Six connected pillars for Shopify commerce operations.",
    description:
      "Each pillar is designed to support both the buying experience customers see and the operational workflows merchants manage.",
    capabilities: [
      { title: "Commerce Growth", problem: "Cart offers can become generic or hard to control.", response: "Present smarter cart and contextual offers through merchant-configurable rules.", labels: ["Smart cart", "Promotion rules", "Product offers"], href: "/platform/growth", linkLabel: "Explore Commerce Growth" },
      { title: "Checkout and Payment Experience", problem: "Checkout steps often require separate login, address, payment, and COD decisions.", response: "Bring OTP login, address prefill, delivery expectation, Razorpay, COD, partial COD, and store credit into a structured flow.", labels: ["OTP at checkout", "Address prefill", "Razorpay", "COD"], href: "/platform/checkout-payments", linkLabel: "Explore Checkout" },
      { title: "Customer Self-Service", problem: "Customers need visibility without creating more unstructured support threads.", response: "Provide order visibility and eligible request tracking through a customer dashboard.", labels: ["Orders", "Requests", "Status"], href: "/platform/customer-experience", linkLabel: "Explore Customer Experience" },
      { title: "Merchant Operations", problem: "Teams need one place to review, approve, and record operational work.", response: "Centralize trackable requests, configuration, payment links where configured, and operational records.", labels: ["Workspace", "Approvals", "Records"], href: "/platform/merchant-operations", linkLabel: "Explore Operations" },
      { title: "Post-Purchase Resolution", problem: "Returns, exchanges, cancellations, and issues are policy-heavy workflows.", response: "Move eligible requests into approval-aware flows with reverse pickup and store-credit options where configured.", labels: ["Exchanges", "Cancellations", "Issues"], href: "/platform/post-purchase", linkLabel: "Explore Resolution" },
      { title: "Retention and Repeat Purchase", problem: "Resolution value is often disconnected from the next purchase.", response: "Make store credit visible and usable when merchant policy allows it.", labels: ["Store credit", "Repeat purchase", "Policy aware"], href: "/platform/retention", linkLabel: "Explore Retention" },
    ] satisfies readonly Capability[],
  },
  customer: { eyebrow: "Customer experience", title: "Clearer self-service without another password.", description: "Customers can use OTP access, repeat-customer address prefill, order visibility, store credit where enabled, and eligible exchange, cancellation, or issue requests subject to merchant policy.", cta: { label: "Explore Customer Experience", href: "/platform/customer-experience" }, items: ["OTP access without another password", "Address prefill for repeat customers", "Expected delivery information", "Store credit visibility where enabled", "Request status visibility"] },
  merchant: { eyebrow: "Merchant operations", title: "One workspace for policy-aware commerce work.", description: "Track eligible requests, approve exchanges, manage reverse pickup where configured, generate payment links where configured, and retain operational records with less dependence on unstructured conversations.", cta: { label: "Explore Merchant Operations", href: "/platform/merchant-operations" }, items: ["Trackable requests", "Exchange approval", "Reverse-pickup workflow", "Payment links where configured", "COD refund resolution through store credit under policy"] },
  checkout: { eyebrow: "Checkout and payments", title: "A buying flow designed around checkout intent.", description: "LoopDesk places OTP login at checkout, then supports address prefill, delivery expectation, inline Razorpay, COD, partial COD, and store credit as a payment option when available.", cta: { label: "Explore Checkout and Payments", href: "/platform/checkout-payments" }, items: ["Express checkout", "OTP login at checkout", "Inline Razorpay experience", "COD and partial COD", "Store credit when available"] },
  growth: { eyebrow: "Commerce growth", title: "More relevant cart offers without promising magic numbers.", description: "Smart cart, cart-content-based offers, merchant-configurable promotion rules, contextual product offers, and estimated benefit presentation help merchants control how offers appear.", cta: { label: "Explore Commerce Growth", href: "/platform/growth" }, items: ["Smart cart drawer", "Cart-content rules", "Contextual offers", "Estimated benefit presentation", "Future extensibility"] },
  postPurchase: { eyebrow: "Post-purchase and store credit", title: "Structured resolution after the order.", description: "Exchanges, cancellations, issue reporting, reverse pickup where configured, approved payment-link workflows, and store-credit refunds can be handled with merchant-policy controls.", cta: { label: "Explore Post-Purchase", href: "/platform/post-purchase" }, items: ["Eligibility depends on merchant policy", "Approval may be required", "Reverse pickup applies where configured", "Store credit follows refund policy"] },
  onePlatform: { eyebrow: "One platform", title: "Replace scattered app handoffs with a connected operating model.", description: "LoopDesk brings cart, checkout, customer accounts, store credit, returns workflows, GST-adjacent records, and support context into one platform subscription with usage charges only for metered infrastructure." },
  founder: { eyebrow: "Founder story", title: "Built from real D2C operating pressure.", description: "BIGONBUY founders operate a growing D2C brand. LoopDesk was built to solve real operational problems and is now being made available to other Shopify merchants through D2C Loop.", cta: { label: "Read Our Story", href: "/company/founder-story" } },
  pricing: { eyebrow: "Simple pricing", title: "One platform subscription, usage charged separately.", description: "LoopDesk is planned as one subscription with all platform capabilities included, no feature tiers, and usage charges for metered infrastructure. Final public pricing is not yet published.", cta: { label: "View Simple Pricing", href: "/pricing" }, secondaryCta: { label: "Install LoopDesk", href: "/install" } },
  faq: [
    ["What is LoopDesk?", "LoopDesk is a Shopify Commerce Experience Platform connecting cart, checkout, payments, customer self-service, merchant operations, post-purchase resolution, store credit, and repeat purchase."],
    ["Is LoopDesk one app or multiple modules?", "It is presented as one platform with connected capabilities rather than separate feature tiers."],
    ["How is pricing structured?", "Pricing is planned as one platform subscription; final public pricing is not yet published."],
    ["Are usage charges separate?", "Yes. Metered infrastructure usage charges are separate from the platform subscription."],
    ["Does LoopDesk replace all customer communication?", "No. It reduces dependence on unstructured channels by moving eligible requests into structured workflows."],
    ["Can customers request exchanges and cancellations?", "Yes, where enabled and eligible under the merchant policy. Approval may be required."],
    ["How does store credit work?", "Store credit can be visible and usable when enabled and when the merchant refund policy allows it."],
    ["Is WhatsApp abandoned-cart recovery available?", "WhatsApp abandoned-cart recovery is planned, not currently available."],
    ["Does it work with every Shopify theme?", "Compatibility depends on the merchant theme and implementation details; installation should be reviewed for each store."],
    ["How do I install LoopDesk?", "Start from the Install LoopDesk flow and complete the required Shopify and merchant configuration steps."],
  ] as const,
  finalCta: { title: "Bring the commerce journey together.", description: "Give customers and merchants a more structured experience with one connected platform, one subscription, and usage charges for metered infrastructure.", primaryCta: { label: "Install LoopDesk", href: "/install" }, secondaryCta: { label: "Book a Demo", href: "/demo" } },
} as const;
