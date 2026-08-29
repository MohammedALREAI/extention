(function () {
  function badgeText(count) {
    if (!Number.isFinite(count) || count <= 0) return "";
    return count > 99 ? "99+" : String(Math.floor(count));
  }
  globalThis.CFBadge = Object.freeze({ badgeText });
})();
