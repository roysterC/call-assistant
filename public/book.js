/*
 * Kikai online booking, on a salon's own website.
 *
 * One line, anywhere on the page:
 *
 *   <script src="https://<app>/book.js" data-salon="<salon-slug>" async></script>
 *
 * Then any of:
 *
 *   <a href="#" data-kikai-book>Book now</a>
 *       Opens booking over the page: full screen on a phone, a box on a
 *       computer. Add data-service="Cut & blow dry" to open on that
 *       service's times, data-stylist="Jo" to pick who with.
 *
 *   <div data-kikai-book-inline></div>
 *       The booking flow as part of the page, as tall as it needs.
 *
 *   data-button="Book now" on the script tag
 *       A "Book now" button fixed to the corner of every page.
 *
 *   window.KikaiBook.open({ service: "Blow dry" })
 *       From the salon's own code.
 *
 * When a booking is made the page gets a "kikai:booked" event on window
 * ({ detail: { bookingNumber, service, start } }), and a "kikai_booked"
 * entry in dataLayer if Google Tag Manager is there, so it can be counted.
 *
 * Nothing here reads or sets cookies on the salon's site.
 */
(function () {
  "use strict";
  if (window.KikaiBook) return;

  var script = document.currentScript;
  var slug = script && script.getAttribute("data-salon");
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    console.error("[Kikai booking] data-salon is required, e.g. data-salon=\"maison-hair\"");
    return;
  }
  var origin = new URL(script.src).origin;
  var MOBILE = 640;

  function urlFor(opts, mode) {
    var p = new URLSearchParams();
    if (mode) p.set("mode", mode);
    if (opts && opts.service) p.set("service", opts.service);
    if (opts && opts.stylist) p.set("stylist", opts.stylist);
    var q = p.toString();
    return origin + "/embed/book/" + encodeURIComponent(slug) + (q ? "?" + q : "");
  }

  // ---- Pop-up -------------------------------------------------------------

  var overlay = null;
  var frame = null;
  var lastFocus = null;
  var savedOverflow = "";

  function layout() {
    if (!frame) return;
    var s = frame.style;
    if (window.innerWidth < MOBILE) {
      s.width = "100%";
      s.height = "100%";
      s.borderRadius = "0";
      s.maxHeight = "none";
    } else {
      s.width = "480px";
      s.height = Math.min(780, Math.round(window.innerHeight * 0.92)) + "px";
      s.borderRadius = "20px";
    }
  }

  function open(opts) {
    if (overlay) close();
    lastFocus = document.activeElement;
    overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Book online");
    var o = overlay.style;
    o.position = "fixed";
    o.inset = "0";
    o.zIndex = "2147483646";
    o.background = "rgba(28, 25, 23, 0.55)";
    o.display = "flex";
    o.alignItems = "center";
    o.justifyContent = "center";

    frame = document.createElement("iframe");
    frame.src = urlFor(opts, "popup");
    frame.title = "Book online";
    var f = frame.style;
    f.border = "0";
    f.background = "#fff";
    f.boxShadow = "0 24px 64px rgba(0,0,0,0.25)";
    f.colorScheme = "normal";
    layout();

    overlay.appendChild(frame);
    // A click on the dimmed page around the box closes it.
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
    document.body.appendChild(overlay);
    savedOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    frame.focus();
  }

  function close() {
    if (!overlay) return;
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    frame = null;
    document.documentElement.style.overflow = savedOverflow;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  window.addEventListener("resize", layout);
  document.addEventListener("keydown", function (e) {
    if (overlay && e.key === "Escape") close();
  });

  // Any element marked data-kikai-book, now or added later.
  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest("[data-kikai-book]") : null;
    if (!el) return;
    e.preventDefault();
    open({
      service: el.getAttribute("data-service"),
      stylist: el.getAttribute("data-stylist"),
    });
  });

  // ---- Inline -------------------------------------------------------------

  var inlineFrames = [];

  function mountInline(el) {
    if (el.getAttribute("data-kikai-mounted")) return;
    el.setAttribute("data-kikai-mounted", "1");
    var f = document.createElement("iframe");
    f.src = urlFor({ service: el.getAttribute("data-service"), stylist: el.getAttribute("data-stylist") }, "inline");
    f.title = "Book online";
    f.style.border = "0";
    f.style.width = "100%";
    f.style.height = "720px";
    f.style.display = "block";
    f.style.colorScheme = "normal";
    el.appendChild(f);
    inlineFrames.push(f);
  }

  function mountAll() {
    var els = document.querySelectorAll("[data-kikai-book-inline]");
    for (var i = 0; i < els.length; i++) mountInline(els[i]);
  }

  // ---- Floating button ----------------------------------------------------

  function addButton(label) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.setAttribute("data-kikai-book", "");
    var s = b.style;
    s.position = "fixed";
    s.right = "20px";
    s.bottom = "20px";
    s.zIndex = "2147483645";
    s.padding = "14px 22px";
    s.borderRadius = "999px";
    s.border = "0";
    s.font = "600 16px/1 system-ui, -apple-system, Segoe UI, sans-serif";
    s.color = script.getAttribute("data-button-text-color") || "#fff";
    s.background = script.getAttribute("data-button-color") || "#1c1917";
    s.boxShadow = "0 8px 24px rgba(0,0,0,0.2)";
    s.cursor = "pointer";
    document.body.appendChild(b);
  }

  // ---- Messages from the booking flow ------------------------------------

  window.addEventListener("message", function (e) {
    if (e.origin !== origin || !e.data || e.data.source !== "kikai-book") return;
    var d = e.data;
    if (d.type === "close") close();
    else if (d.type === "resize" && typeof d.height === "number") {
      for (var i = 0; i < inlineFrames.length; i++) {
        if (inlineFrames[i].contentWindow === e.source) {
          inlineFrames[i].style.height = Math.max(400, Math.min(d.height, 4000)) + "px";
        }
      }
    } else if (d.type === "booked") {
      var detail = { bookingNumber: d.bookingNumber, service: d.service, start: d.start };
      try {
        window.dispatchEvent(new CustomEvent("kikai:booked", { detail: detail }));
      } catch {
        /* very old browsers */
      }
      if (Array.isArray(window.dataLayer)) {
        window.dataLayer.push({ event: "kikai_booked", kikai: detail });
      }
    }
  });

  function ready() {
    mountAll();
    var label = script.getAttribute("data-button");
    if (label) addButton(label);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();

  window.KikaiBook = { open: open, close: close, mount: mountAll };
})();
