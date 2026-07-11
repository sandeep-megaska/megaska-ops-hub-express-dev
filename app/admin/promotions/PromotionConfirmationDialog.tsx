"use client";
export default function PromotionConfirmationDialog({ open, title, message, confirmLabel, destructive, onCancel, onConfirm }: { open: boolean; title: string; message: string; confirmLabel: string; destructive?: boolean; onCancel: () => void; onConfirm: () => void }) {
  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
    <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
      <h2 id="confirm-title" className="text-lg font-semibold text-gray-900">{title}</h2>
      <p id="confirm-message" className="mt-2 text-sm text-gray-600">{message}</p>
      <div className="mt-5 flex justify-end gap-3"><button type="button" onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500">Cancel</button><button type="button" onClick={onConfirm} className={`rounded-lg px-4 py-2 text-sm font-semibold text-white focus:outline-none focus:ring-2 ${destructive ? "bg-red-700 focus:ring-red-500" : "bg-blue-700 focus:ring-blue-500"}`}>{confirmLabel}</button></div>
    </div>
  </div>;
}
