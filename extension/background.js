// Keryx extension service worker.
//
// Two right-click entry points:
//   1. On selected text → "Ask Keryx about this" — stash the selection + its page, then open the
//      popup UI in a small window so the answer streams without leaving the page.
//   2. On the page      → "List this page as a paid source" — deep-link the creator to /register
//      with the URL + title pre-filled, so a page they own can start earning per citation.
importScripts("keryx-config.js");

const ASK_MENU = "keryx-ask";
const LIST_MENU = "keryx-list";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: ASK_MENU,
      title: 'Ask Keryx about "%s"',
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: LIST_MENU,
      title: "List this page as a paid source on Keryx",
      contexts: ["page"],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === ASK_MENU) {
    const pending = {
      question: (info.selectionText || "").trim(),
      sourceUrl: tab?.url || info.pageUrl || "",
      sourceTitle: tab?.title || "",
    };
    // Hand the selection to the popup via storage, then open it as its own small window.
    chrome.storage.local.set({ [KERYX_PENDING_KEY]: pending }, () => {
      chrome.windows.create({
        url: chrome.runtime.getURL("popup.html?src=menu"),
        type: "popup",
        width: 440,
        height: 680,
      });
    });
    return;
  }

  if (info.menuItemId === LIST_MENU) {
    const url = tab?.url || info.pageUrl || "";
    const name = tab?.title || "";
    const target = `${KERYX_REGISTER}?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`;
    chrome.tabs.create({ url: target });
  }
});
