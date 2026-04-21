export default function IssuesPage() {
  const issues = [
    {
      ticket: "ISS-301",
      order: "#MK2102",
      issue: "Damaged item received",
      status: "Open",
      badge: "danger",
    },
    {
      ticket: "ISS-302",
      order: "#MK2103",
      issue: "Wrong size delivered",
      status: "Investigating",
      badge: "warning",
    },
    {
      ticket: "ISS-303",
      order: "#MK2104",
      issue: "Missing item in package",
      status: "Resolved",
      badge: "success",
    },
  ];

  return (
    <div className="mk-page">
      <div className="mk-page-header">
        <div>
          <h1 className="mk-page-title">Issues</h1>
          <p className="mk-page-subtitle">
            Track customer-reported issues, resolutions, and support operations.
          </p>
        </div>

        <div className="mk-header-actions">
          <button className="mk-btn">Refresh</button>
          <button className="mk-btn mk-btn-primary">Create Case</button>
        </div>
      </div>

      <section className="mk-grid-4">
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Open Issues</p>
          <p className="mk-stat-value">14</p>
          <p className="mk-stat-meta">Require active support review</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Investigating</p>
          <p className="mk-stat-value">8</p>
          <p className="mk-stat-meta">Pending ops verification</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Resolved Today</p>
          <p className="mk-stat-value">5</p>
          <p className="mk-stat-meta">Closed after resolution</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">High Priority</p>
          <p className="mk-stat-value">3</p>
          <p className="mk-stat-meta">Needs immediate action</p>
        </div>
      </section>

      <section className="mk-card">
        <h2 className="mk-section-title">Issue Queue</h2>
        <p className="mk-section-subtitle">
          All active issue tickets in current operational scope.
        </p>

        <div className="mk-table-wrap">
          <table className="mk-table">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Order</th>
                <th>Issue</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr key={issue.ticket}>
                  <td>{issue.ticket}</td>
                  <td>{issue.order}</td>
                  <td>{issue.issue}</td>
                  <td>
                    <span className={`mk-badge mk-badge-${issue.badge}`}>
                      {issue.status}
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
