import { ExpressCheckoutSettingsForm } from '../../../components/express-checkout/express-checkout-settings-form'

export default function ExpressCheckoutSettingsPage() {
  return <main className="mx-auto max-w-3xl p-6">
    <h1 className="text-2xl font-bold text-gray-950">Express Checkout</h1>
    <p className="mt-2 text-sm text-gray-600">Manage checkout payment copy and charges.</p>
    <div className="mt-6"><ExpressCheckoutSettingsForm /></div>
  </main>
}
