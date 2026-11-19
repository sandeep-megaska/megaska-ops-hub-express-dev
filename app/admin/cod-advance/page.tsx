// Partial COD (an advance collected online before a COD order) is not available.
// The advance was collected through a Razorpay link outside Shopify Checkout,
// which Shopify App Store requirement 1.1.2 does not allow, so it was retired
// with Express Checkout. The page stays so old links don't break.
export default function CodAdvanceAdminPage() {
  return <main className="mk-page mx-auto max-w-6xl">
    <header className="mk-page-header">
      <div>
        <p className="mk-section-subtitle" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Payments</p>
        <h1 className="mk-page-title">Partial COD</h1>
        <p className="mk-page-subtitle">Not available.</p>
      </div>
    </header>
    <div className="mk-alert mk-alert-info">
      Collecting part of a COD order&apos;s value online is not currently available: every payment happens on Shopify Checkout.
      Cash on Delivery itself, its eligibility rules and the prepaid incentive keep working as configured.
    </div>
  </main>
}
