"use client";

import { useState } from "react";
import { useEmbeddedAdminStatus } from "./AdminEmbeddedProvider";

function yesNo(value?: boolean) {
  return value ? "yes" : "no";
}

export default function AdminEmbeddedDiagnostic() {
  const status = useEmbeddedAdminStatus();
  const [message, setMessage] = useState("");

  async function testResourcePicker() {
    setMessage("");
    const picker = window.shopify?.resourcePicker;
    if (!picker) {
      setMessage("Resource Picker is unavailable. Open from Shopify Admin with shop, host, and SHOPIFY_API_KEY configured.");
      return;
    }
    try {
      await picker({ type: "product", multiple: false, action: "select" });
      setMessage("Resource Picker opened successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Resource Picker test failed.");
    }
  }

  if (!status) return null;

  return (
    <aside className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-950">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">Embedded admin diagnostic</p>
        <button type="button" onClick={testResourcePicker} className="rounded-lg border border-blue-200 bg-white px-2 py-1 font-medium text-blue-950">
          Test Resource Picker
        </button>
      </div>
      <p>shop present: {yesNo(status.shopPresent)}; host present: {yesNo(status.hostPresent)}; API key present: {yesNo(status.apiKeyPresent)}; API key meta present: {yesNo(status.apiKeyMetaPresent)}; API key meta content length: {status.apiKeyMetaContentLength}; App Bridge script tag present: {yesNo(status.appBridgeScriptTagPresent)}; App Bridge script loaded event fired: {yesNo(status.appBridgeScriptLoadedEventFired)}; window.shopify present: {yesNo(status.shopifyGlobalPresent)}; typeof window.shopify.resourcePicker: {status.resourcePickerType}; App Bridge initialized: {yesNo(status.appBridgeInitialized)}; Resource Picker available: {yesNo(status.resourcePickerAvailable)}.</p>
      {status.appBridgeScriptError ? <p className="mt-1 text-red-900">Script load error: {status.appBridgeScriptError}</p> : null}
      <p>current route: {status.currentRoute || "—"}</p>
      {!status.appBridgeInitialized ? <p className="mt-1 text-amber-900">Fallback: admin pages remain usable, but Shopify embedded features need a valid Admin launch URL and API key.</p> : null}
      {message ? <p className="mt-1 font-medium">{message}</p> : null}
    </aside>
  );
}
