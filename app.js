// app.js
// Legacy compatibility shim.
// The app now uses page modules from ./js/main.js for all page behaviour.
(() => {
  if (typeof window !== "undefined") {
    window.__RB_LEGACY_APP_JS__ = "disabled";
    console.info("[RB] app.js is deprecated; using js/main.js page modules.");
  }
})();
