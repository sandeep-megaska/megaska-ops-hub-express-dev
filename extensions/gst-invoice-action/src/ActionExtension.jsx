// Diagnostic build: no Preact, no JSX, no hooks - pure vanilla DOM APIs.
// Every prior test showed render() from Preact "succeeding" with zero
// errors while the component function itself was never invoked, and
// the modal stayed empty. This isolates whether Preact is the actual
// broken link by building the exact same UI with document.createElement.
export default async () => {
  console.log("[gst-invoice-action] vanilla module executing");
  try {
    const { close, i18n } = shopify;
    console.log("[gst-invoice-action] shopify global", { hasClose: typeof close, hasI18n: typeof i18n });

    const action = document.createElement("s-admin-action");
    action.heading = i18n.translate("name");
    console.log("[gst-invoice-action] created s-admin-action, heading set to", action.heading);

    const closeButton = document.createElement("s-button");
    closeButton.setAttribute("slot", "secondary-actions");
    closeButton.textContent = i18n.translate("close");
    closeButton.addEventListener("click", () => close());
    action.appendChild(closeButton);
    console.log("[gst-invoice-action] appended secondary-action close button");

    const statusText = document.createElement("s-text");
    statusText.textContent = "Vanilla DOM build - if you can see this, Preact was the problem.";
    action.appendChild(statusText);
    console.log("[gst-invoice-action] appended status text");

    document.body.appendChild(action);
    console.log("[gst-invoice-action] appended s-admin-action to document.body; body now has", document.body.children.length, "children");
  } catch (error) {
    console.error("[gst-invoice-action] vanilla build threw", error);
  }
};
