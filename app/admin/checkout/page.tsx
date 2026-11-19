import { ExpressCheckoutSettingsForm } from '../../../components/express-checkout/express-checkout-settings-form'

export default function CheckoutSettingsPage() {
  return <main className="mk-page mx-auto max-w-3xl">
    <header className="mk-page-header">
      <div>
        <h1 className="mk-page-title">Prepaid offer &amp; COD</h1>
        <p className="mk-page-subtitle">Prepaid discount, Cash on Delivery charge and copy, and phone verification before Shopify Checkout.</p>
      </div>
    </header>
    <ExpressCheckoutSettingsForm />
  </main>
}
