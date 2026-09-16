import { prisma } from "@/lib/db";

/**
 * The embed loader.
 *
 * This is the answer to "integrate into her existing website": one script tag
 * on the clinic's current WordPress site, no migration, no plugin.
 *
 *   <div id="clinicdesk-booking"></div>
 *   <script src="https://app.clinicdesk.in/api/embed/heal" async></script>
 *
 * It mounts an iframe rather than injecting markup, so the host page's CSS
 * cannot break the booking form and our styles cannot leak into their site.
 * The iframe auto-resizes via postMessage, keyed to this specific frame.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ clinicSlug: string }> },
) {
  const { clinicSlug } = await params;

  const clinic = await prisma.clinic.findUnique({
    where: { slug: clinicSlug },
    select: { slug: true, status: true, primaryColor: true },
  });

  if (!clinic || clinic.status === "SUSPENDED") {
    return new Response(`console.warn("[clinicdesk] unknown clinic: ${clinicSlug}");`, {
      status: 404,
      headers: { "Content-Type": "application/javascript; charset=utf-8" },
    });
  }

  const base = process.env.APP_BASE_URL ?? "";
  const src = `${base}/book/${encodeURIComponent(clinic.slug)}?embed=1`;

  const script = `(function () {
  var MOUNT_IDS = ["clinicdesk-booking", "clinicdesk-widget"];
  var current = document.currentScript;

  function findMount() {
    for (var i = 0; i < MOUNT_IDS.length; i++) {
      var el = document.getElementById(MOUNT_IDS[i]);
      if (el) return el;
    }
    // No container on the page: fall back to inserting where the tag sits, so
    // a copy-pasted script tag alone still works.
    if (current && current.parentNode) {
      var host = document.createElement("div");
      current.parentNode.insertBefore(host, current);
      return host;
    }
    return null;
  }

  function mount() {
    var target = findMount();
    if (!target || target.getAttribute("data-clinicdesk-mounted")) return;
    target.setAttribute("data-clinicdesk-mounted", "1");

    var frame = document.createElement("iframe");
    frame.src = ${JSON.stringify(src)};
    frame.title = "Book an appointment";
    frame.loading = "lazy";
    frame.setAttribute("scrolling", "no");
    frame.style.cssText = "width:100%;border:0;display:block;min-height:520px;color-scheme:normal;";
    target.appendChild(frame);

    window.addEventListener("message", function (event) {
      if (!event.data || event.data.source !== "clinicdesk") return;
      if (event.source !== frame.contentWindow) return;
      if (event.data.type === "resize" && typeof event.data.height === "number") {
        frame.style.height = Math.max(320, event.data.height) + "px";
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();`;

  return new Response(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
    },
  });
}
