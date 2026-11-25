// Toolbar icon: show or hide the floating panel in the current Meet tab.
chrome.action.onClicked.addListener((tab) => {
  // Without the "tabs" permission tab.url is not visible: just try. Tabs that are
  // not Meet have no content script and the message is ignored.
  if (!tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "toggle-panel" }).catch(() => {});
});
