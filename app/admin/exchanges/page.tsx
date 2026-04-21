export default function ExchangesPage() {
  const requests = [
    {
      order: "#MK2088",
      item: "Classic Black Tee / M",
      customer: "Rohit K",
      status: "Pending Review",
      badge: "warning",
    },
    {
      order: "#MK2084",
      item: "Oversized Shirt / L",
      customer: "Sana A",
      status: "Approved",
      badge: "success",
    },
    {
      order: "#MK2079",
      item: "Cargo Jogger / XL",
      customer: "Irfan P",
      status: "In Transit",
      badge: "neutral",
    },
  ];

  return (
    <div className="mk-page">
      <div className="mk-page-header">
        <div>
          <h1 className="mk-page-title">Exchanges</h1>
          <p className="mk-page-subtitle">
            Monitor exchange requests, fulfillment status, and approval flow.
          </p>
        </div>

        <div className="mk-header-actions">
          <button className="mk-btn">Filter</button>
          <button className="mk-btn mk-btn-primary">Create Exchange Rule</button>
        </div>
      </div>

      <section className="mk-grid-4">
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Open Exchanges</p>
          <p className="mk-stat-value">42</p>
          <p className="mk-stat-meta">Active exchange requests</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Approved Today</p>
          <p className="mk-stat-value">9</p>
          <p className="mk-stat-meta">Moved to next workflow stage</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">In Transit</p>
          <p className="mk-stat-value">13</p>
          <p className="mk-stat-meta">Customer return or replacement transit</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Completed</p>
          <p className="mk-stat-value">286</p>
          <p className="mk-stat-meta">Successfully closed exchanges</p>
        </div>
      </section>

      <section className="mk-card">
        <h2 className="mk-section-title">Exchange Queue</h2>
        <p className="mk-section-subtitle">
          Current exchange workflow items needing review or fulfillment.
        </p>

        <div className="mk-list">
          {requests.map((request) => (
            <div className="mk-list-row" key={`${request.order}-${request.item}`}>
              <div>
                <p className="mk-list-title">{request.order}</p>
                <p className="mk-list-subtitle">{request.item}</p>
                <p className="mk-list-subtitle">Customer: {request.customer}</p>
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
