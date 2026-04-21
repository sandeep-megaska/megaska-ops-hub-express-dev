export default function GstPage() {
  const records = [
    {
      invoice: "GST-1045",
      order: "#MK2105",
      customer: "Aman Raj",
      status: "Synced",
      badge: "success",
    },
    {
      invoice: "GST-1046",
      order: "#MK2106",
      customer: "Neha S",
      status: "Pending",
      badge: "warning",
    },
    {
      invoice: "GST-1047",
      order: "#MK2107",
      customer: "Rafi P",
      status: "Failed",
      badge: "danger",
    },
  ];

  return (
    <div className="mk-page">
      <div className="mk-page-header">
        <div>
          <h1 className="mk-page-title">GST Management</h1>
          <p className="mk-page-subtitle">
            Manage invoice sync, dispatch workflows, and GST operation status.
          </p>
        </div>

        <div className="mk-header-actions">
          <button className="mk-btn">Export</button>
          <button className="mk-btn mk-btn-primary">Run GST Sync</button>
        </div>
      </div>

      <section className="mk-grid-4">
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Invoices Synced</p>
          <p className="mk-stat-value">1,248</p>
          <p className="mk-stat-meta">Across current store scope</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Pending Queue</p>
          <p className="mk-stat-value">18</p>
          <p className="mk-stat-meta">Awaiting sync or validation</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Dispatch Linked</p>
          <p className="mk-stat-value">92%</p>
          <p className="mk-stat-meta">Invoice to dispatch success rate</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Failures</p>
          <p className="mk-stat-value">6</p>
          <p className="mk-stat-meta">Needs manual review</p>
        </div>
      </section>

      <section className="mk-card">
        <h2 className="mk-section-title">Recent GST Activity</h2>
        <p className="mk-section-subtitle">
          Latest invoice and sync records from the operations queue.
        </p>

        <div className="mk-table-wrap">
          <table className="mk-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Order</th>
                <th>Customer</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {records.map((row) => (
                <tr key={row.invoice}>
                  <td>{row.invoice}</td>
                  <td>{row.order}</td>
                  <td>{row.customer}</td>
                  <td>
                    <span className={`mk-badge mk-badge-${row.badge}`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
