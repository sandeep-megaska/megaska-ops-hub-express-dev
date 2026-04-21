export default function CancellationsPage() {
  const requests = [
    {
      order: "#MK2120",
      customer: "Vivek S",
      reason: "Ordered by mistake",
      status: "Pending",
      badge: "warning",
    },
    {
      order: "#MK2118",
      customer: "Asha P",
      reason: "Delivery delay",
      status: "Approved",
      badge: "success",
    },
    {
      order: "#MK2111",
      customer: "Ramesh T",
      reason: "Already shipped",
      status: "Locked",
      badge: "danger",
    },
  ];

  return (
    <div className="mk-page">
      <div className="mk-page-header">
        <div>
          <h1 className="mk-page-title">Cancellations</h1>
          <p className="mk-page-subtitle">
            Review cancellation requests and manage pre-shipment intervention.
          </p>
        </div>

        <div className="mk-header-actions">
          <button className="mk-btn">View Policies</button>
          <button className="mk-btn mk-btn-primary">Export Requests</button>
        </div>
      </div>

      <section className="mk-grid-4">
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Pending Requests</p>
          <p className="mk-stat-value">11</p>
          <p className="mk-stat-meta">Waiting for team action</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Approved</p>
          <p className="mk-stat-value">38</p>
          <p className="mk-stat-meta">Cleared for cancellation flow</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Rejected / Locked</p>
          <p className="mk-stat-value">7</p>
          <p className="mk-stat-meta">Already shipped or not eligible</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Today’s Volume</p>
          <p className="mk-stat-value">6</p>
          <p className="mk-stat-meta">New cancellation entries</p>
        </div>
      </section>

      <section className="mk-card">
        <h2 className="mk-section-title">Cancellation Queue</h2>
        <p className="mk-section-subtitle">
          Latest requests and their current processing status.
        </p>

        <div className="mk-list">
          {requests.map((request) => (
            <div className="mk-list-row" key={`${request.order}-${request.customer}`}>
              <div>
                <p className="mk-list-title">{request.order}</p>
                <p className="mk-list-subtitle">Customer: {request.customer}</p>
                <p className="mk-list-subtitle">Reason: {request.reason}</p>
              </div>

              <span className={`mk-badge mk-badge-${request.badge}`}>
                {request.status}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
