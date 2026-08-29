(function () {
  function installBadgeHandlers(chromeApi, setBadge) {
    chromeApi.runtime.onMessage.addListener((message, sender) => {
      if (message?.type === "CF_PROTECTION_COUNT" && sender.tab?.id !== undefined) setBadge(sender.tab.id, Number(message.count) || 0);
      return false;
    });
    chromeApi.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.status === "loading") setBadge(tabId, 0);
    });
  }
  globalThis.CFBadgeHandlers = Object.freeze({ installBadgeHandlers });
})();
