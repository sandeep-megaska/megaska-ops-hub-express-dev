import { render } from "preact";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const { close, i18n } = shopify;

  return (
    <s-admin-action heading={i18n.translate("name")}>
      <s-button slot="secondary-actions" onClick={close}>
        {i18n.translate("close")}
      </s-button>
      <s-text>Diagnostic build - if you can see this, the crash is not in the extension's base render.</s-text>
    </s-admin-action>
  );
}
