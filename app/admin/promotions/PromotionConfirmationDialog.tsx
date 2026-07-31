"use client";
export default function PromotionConfirmationDialog({ open, title, message, confirmLabel, destructive, onCancel, onConfirm }: { open: boolean; title: string; message: string; confirmLabel: string; destructive?: boolean; onCancel: () => void; onConfirm: () => void }) {
  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
    <div className="mk-card w-full max-w-md" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
      <h2 id="confirm-title" className="mk-section-title">{title}</h2>
      <p id="confirm-message" className="mk-section-subtitle">{message}</p>
      <div className="mt-5 flex justify-end gap-3"><button type="button" onClick={onCancel} className="mk-btn">Cancel</button><button type="button" onClick={onConfirm} className={`mk-btn ${destructive ? "mk-btn-danger" : "mk-btn-primary"}`}>{confirmLabel}</button></div>
    </div>
  </div>;
}
