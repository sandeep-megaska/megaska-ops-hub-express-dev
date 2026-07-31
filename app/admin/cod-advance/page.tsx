import { CodAdvanceSettingsForm } from '../../../components/cod-advance/cod-advance-settings-form'

export default function CodAdvanceAdminPage() {
  return <main className="mk-page mx-auto max-w-6xl">
    <header className="mk-page-header">
      <div>
        <p className="mk-section-subtitle" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Payments</p>
        <h1 className="mk-page-title">Partial COD</h1>
        <p className="mk-page-subtitle">Collect a fixed or percentage advance before confirming Cash on Delivery orders.</p>
      </div>
    </header>
    <CodAdvanceSettingsForm />
  </main>
}
