"use client";

import { useEffect } from "react";

/**
 * Reports the embedded widget's height to the host page so the iframe can grow
 * with the form instead of showing an inner scrollbar. Only rendered in embed
 * mode; a no-op when the page isn't framed.
 */
export function EmbedResizer() {
  useEffect(() => {
    if (window.parent === window) return;

    const post = () => {
      const height = Math.ceil(document.documentElement.scrollHeight);
      window.parent.postMessage({ source: "clinicdesk", type: "resize", height }, "*");
    };

    post();
    const observer = new ResizeObserver(post);
    observer.observe(document.body);
    window.addEventListener("load", post);

    return () => {
      observer.disconnect();
      window.removeEventListener("load", post);
    };
  }, []);

  return null;
}
