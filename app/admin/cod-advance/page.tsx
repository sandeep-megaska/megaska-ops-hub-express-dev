import { CodAdvanceSettingsForm } from '../../../components/cod-advance/cod-advance-settings-form'

export default function CodAdvanceAdminPage() {
  return <main className="mx-auto max-w-6xl px-6 py-8 space-y-6">
    <div>
      <p className="text-sm font-semibold uppercase tracking-wide text-gray-500">Payments</p>
      <h1 className="text-2xl font-bold text-gray-950">Fixed COD Advance</h1>
      <p className="mt-2 text-sm text-gray-600">Configure the isolated Partial COD fixed advance module.</p>
    </div>
    <CodAdvanceSettingsForm />
  </main>
}
