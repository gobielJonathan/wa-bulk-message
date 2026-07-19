// 1. GHOST GUARD: Prevents crashes if Chrome injects this file twice
if (typeof window.waSenderInjected === "undefined") {
  window.waSenderInjected = true;
  window.waSenderAborted = false;

  const sleep = (ms) => new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (window.waSenderAborted) { reject(new Error("Aborted")); return; }
      if (Date.now() - start >= ms) { resolve(); return; }
      setTimeout(check, 100);
    };
    check();
  });

  async function waitForElement(selector, maxWaitTime = 8000) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitTime) {
      if (window.waSenderAborted) throw new Error("Aborted");
      const element = document.querySelector(selector);
      if (element && element.offsetParent !== null) {
        return element;
      }
      await sleep(500);
    }
    return null;
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "EXECUTE_SEND") {
      window.waSenderAborted = false;
      executeWhatsAppWorkflow(request.phone, request.message)
        .then(() => sendResponse({ success: true }))
        .catch((err) => {
          const errorMsg = err?.message || String(err);
          sendResponse({ success: false, error: errorMsg, aborted: window.waSenderAborted });
        });

      return true;
    }

    if (request.action === "ABORT_SEND") {
      window.waSenderAborted = true;
      sendResponse({ ok: true });
      return true;
    }
  });

  async function executeWhatsAppWorkflow(phone, messageText) {
    // --- STEP 1: Click "New Chat" ---
    // Using your aria-label with the standard icon fallback
    const newChatBtn = await waitForElement(
      'button[aria-label="New chat"], span[data-icon="new-chat-outline"]',
      5000,
    );
    if (!newChatBtn) throw new Error("Could not find 'New Chat' button.");
    (newChatBtn.closest("button") || newChatBtn).click();

    await sleep(2000)
    
    // --- STEP 2: Find Search Input and Type Number ---
    const searchInput = await waitForElement(
      'input[aria-label^="Search name"]',
      5000,
    );
    if (!searchInput) throw new Error("Could not find search input.");

    searchInput.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
    document.execCommand("insertText", false, phone);

    const isNotFound = await waitForElement(
      '[data-testid="search-no-results-without-keyword"]',
      5000,
    );
    if (isNotFound) {
      const backBtn = document.querySelector('button[aria-label="Back"]');
      if (backBtn) (backBtn.closest("button") || backBtn).click();
      throw new Error("Number not registered or not found in search.");
    }

    await sleep(7000);

    // --- STEP 3: Wait for Contact Result ---
    const clickableTarget = await waitForElement(
      '[data-testid="cell-frame-container"]',
      8000,
    );

    // --- STEP 4: Robust Click ---
    clickableTarget.click(); // Try native click first

    // --- STEP 5: Find Message Box and Paste Text ---
    const messageBox = await waitForElement(
      'footer div[contenteditable="true"]',
      8000,
    );
    if (!messageBox) throw new Error("Could not find message input box.");

    messageBox.focus();
    await sleep(2000);

    const cleanText = messageText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const dt = new DataTransfer();
    dt.setData("text/plain", cleanText);
    messageBox.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));

    await sleep(2000);

    // --- STEP 6: Click Send ---
    const sendBtn = document.querySelector(
      'button[aria-label="Send"], span[data-icon="send"]',
    );
    if (!sendBtn) throw new Error("Could not find 'Send' button.");
    (sendBtn.closest("button") || sendBtn).click();

    return true;
  }
} else {
  console.log("WA Sender Content Script already loaded.");
}
