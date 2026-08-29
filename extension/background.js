importScripts("policy.js", "badge.js", "badgeService.js", "badgeHandlers.js");

chrome.runtime.onInstalled.addListener(async () => {
  const policy = await globalThis.CFPolicy.loadPolicy();
  await globalThis.CFPolicy.savePolicy(policy);
});

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type === "CF_GET_POLICY") {
    globalThis.CFPolicy.loadPolicy().then(respond);
    return true;
  }
  return false;
});

globalThis.CFBadgeHandlers.installBadgeHandlers(chrome, (tabId, count) => globalThis.CFBadgeService.setProtectionBadge(chrome, tabId, count));
