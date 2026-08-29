(function () {
  function setProtectionBadge(chromeApi, tabId, count) {
    const text = globalThis.CFBadge.badgeText(count);
    chromeApi.action.setBadgeText({ tabId, text });
    if (text) {
      chromeApi.action.setBadgeBackgroundColor({ tabId, color: "#6d5dfc" });
      chromeApi.action.setTitle({ tabId, title: `${count} protected content item${count === 1 ? "" : "s"}` });
    } else {
      chromeApi.action.setTitle({ tabId, title: "Content Firewall" });
    }
    return text;
  }
  globalThis.CFBadgeService = Object.freeze({ setProtectionBadge });
})();
