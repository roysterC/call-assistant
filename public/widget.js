(function () {
  "use strict";

  // Guard against duplicate loads
  if (window.__doaiWidgetLoaded) return;
  window.__doaiWidgetLoaded = true;

  var script = document.currentScript;
  var siteId = script && script.getAttribute("data-site-id");
  if (!siteId) {
    console.error("[DOAI Widget] data-site-id attribute is required");
    return;
  }

  // Below this, an open chat takes the whole screen. A 380px panel inset by
  // 20px on a 375px phone leaves ~355px of usable width wrapped in rounded
  // corners and shadow — cramped, and it wastes the space where the keyboard
  // is about to appear.
  var MOBILE_BREAKPOINT = 640;

  var PANEL_WIDTH = 380;
  var PANEL_HEIGHT = 600;
  var BUBBLE = 72;
  var TEASER_WIDTH = 320;
  var TEASER_HEIGHT = 150;
  var EDGE = 20;

  var origin = new URL(script.src).origin;
  var iframe = document.createElement("iframe");
  iframe.src = origin + "/embed?siteId=" + encodeURIComponent(siteId);
  iframe.title = "Chat";
  iframe.setAttribute("allow", "clipboard-write");

  // "bubble" | "teaser" | "open" — what the embed page wants to present.
  var state = "bubble";
  var scrollLock = null;

  // Placement and collapsed size are config-driven, so they arrive from the
  // embed page (which is what loads the config) rather than being decided
  // here. These are the defaults until that first message lands.
  var placement = { position: "right", offset: EDGE };
  var collapsedSize = { width: BUBBLE, height: BUBBLE };

  function isMobile() {
    return window.innerWidth < MOBILE_BREAKPOINT;
  }

  function currentMode() {
    if (state === "open") return isMobile() ? "fullscreen" : "panel";
    if (state === "teaser") return "teaser";
    return "bubble";
  }

  function baseStyle() {
    iframe.style.position = "fixed";
    iframe.style.border = "0";
    iframe.style.zIndex = "2147483647";
    iframe.style.background = "transparent";
    iframe.style.colorScheme = "normal";
  }

  function applyGeometry() {
    var mode = currentMode();
    var s = iframe.style;
    baseStyle();

    if (mode === "fullscreen") {
      // Pin to the visual viewport rather than the layout viewport, so the
      // panel shrinks when the on-screen keyboard opens instead of the input
      // sliding underneath it. Falls back to the layout viewport where
      // visualViewport is unavailable.
      var vv = window.visualViewport;
      s.top = (vv ? vv.offsetTop : 0) + "px";
      s.left = (vv ? vv.offsetLeft : 0) + "px";
      s.right = "auto";
      s.bottom = "auto";
      s.width = (vv ? vv.width : window.innerWidth) + "px";
      s.height = (vv ? vv.height : window.innerHeight) + "px";
      s.maxWidth = "none";
      s.maxHeight = "none";
      s.borderRadius = "0";
      s.boxShadow = "none";
      s.transition = "none";
    } else {
      // Everything other than full-screen is anchored to the configured
      // corner. Position is set on one axis and explicitly cleared on the
      // other, so switching sides at runtime doesn't leave a stale offset
      // pinning it to both.
      var off = placement.offset;
      s.top = "auto";
      s.bottom = off + "px";
      if (placement.position === "left") {
        s.left = off + "px";
        s.right = "auto";
      } else {
        s.right = off + "px";
        s.left = "auto";
      }
      s.maxWidth = "calc(100vw - " + off + "px)";
      s.maxHeight = "calc(100vh - " + off + "px)";

      if (mode === "panel") {
        s.width = PANEL_WIDTH + "px";
        s.height = PANEL_HEIGHT + "px";
        s.borderRadius = "16px";
        s.boxShadow = "0 10px 30px rgba(0,0,0,0.15)";
        s.transition =
          "width 0.2s ease, height 0.2s ease, border-radius 0.2s ease";
      } else if (mode === "teaser") {
        // The teaser card and launcher carry their own rounding and shadow, so
        // the iframe itself must be a plain transparent rectangle — a radius or
        // shadow here would frame the empty space around them.
        s.width = TEASER_WIDTH + "px";
        s.height = TEASER_HEIGHT + "px";
        s.borderRadius = "0";
        s.boxShadow = "none";
        s.transition = "none";
      } else {
        // A labelled launcher is a pill, not a circle, so the embed page sends
        // the size it actually needs rather than us assuming 72x72.
        s.width = collapsedSize.width + "px";
        s.height = collapsedSize.height + "px";
        s.borderRadius = "9999px";
        s.boxShadow = "0 10px 30px rgba(0,0,0,0.15)";
        s.transition =
          "width 0.2s ease, height 0.2s ease, border-radius 0.2s ease";
      }
    }

    setScrollLock(mode === "fullscreen");
    tellIframe(mode);
  }

  // Full-screen chat over a host page that still scrolls behind it feels
  // broken. Snapshot whatever the host had set so it can be handed back
  // exactly — never assume it was the default.
  function setScrollLock(on) {
    var body = document.body;
    if (!body) return;

    if (on && !scrollLock) {
      scrollLock = {
        overflow: body.style.overflow,
        touchAction: body.style.touchAction,
      };
      body.style.overflow = "hidden";
      body.style.touchAction = "none";
    } else if (!on && scrollLock) {
      body.style.overflow = scrollLock.overflow;
      body.style.touchAction = scrollLock.touchAction;
      scrollLock = null;
    }
  }

  // Tell the embed page which shape it is in, so it can drop its own rounded
  // corners when full-screen — a rounded panel inside a square iframe shows
  // transparent notches at the corners.
  function tellIframe(mode) {
    if (!iframe.contentWindow) return;
    iframe.contentWindow.postMessage({ type: "doai:mode", mode: mode }, origin);
  }

  function mount() {
    applyGeometry();
    document.body.appendChild(iframe);
  }

  if (document.body) {
    mount();
  } else {
    document.addEventListener("DOMContentLoaded", mount);
  }

  window.addEventListener("message", function (e) {
    if (!iframe.contentWindow || e.source !== iframe.contentWindow) return;
    if (!e.data || e.data.type !== "doai:resize") return;

    // The embed page reports which state it wants; the parent decides the
    // geometry, since only it can see the host viewport. Both older shapes are
    // still understood — an `open` boolean, or bare width/height.
    if (
      e.data.state === "bubble" ||
      e.data.state === "teaser" ||
      e.data.state === "open"
    ) {
      state = e.data.state;
    } else if (typeof e.data.open === "boolean") {
      state = e.data.open ? "open" : "bubble";
    } else {
      state = Number(e.data.width) > BUBBLE ? "open" : "bubble";
    }

    if (e.data.position === "left" || e.data.position === "right") {
      placement.position = e.data.position;
    }
    if (typeof e.data.offset === "number" && e.data.offset >= 0) {
      placement.offset = e.data.offset;
    }
    if (state === "bubble" && Number(e.data.width) > 0) {
      collapsedSize.width = Number(e.data.width);
      collapsedSize.height = Number(e.data.height) || BUBBLE;
    }

    applyGeometry();
  });

  // Rotation, window resize, and the on-screen keyboard all change the shape
  // an open chat should take.
  window.addEventListener("resize", function () {
    applyGeometry();
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", function () {
      if (state === "open" && isMobile()) applyGeometry();
    });
    window.visualViewport.addEventListener("scroll", function () {
      if (state === "open" && isMobile()) applyGeometry();
    });
  }
})();
