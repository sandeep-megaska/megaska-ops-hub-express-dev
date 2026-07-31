import { ExpressCheckoutSettingsForm } from '../../../components/express-checkout/express-checkout-settings-form'

export default function ExpressCheckoutSettingsPage() {
  return <main className="mk-page mx-auto max-w-3xl">
    <header className="mk-page-header">
      <div>
        <h1 className="mk-page-title">Express Checkout</h1>
        <p className="mk-page-subtitle">Manage checkout payment copy and charges.</p>
      </div>
    </header>
    <ExpressCheckoutSettingsForm />
  </main>
}
