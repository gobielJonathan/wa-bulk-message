// 1. GHOST GUARD: Prevents crashes if Chrome injects this file twice
if (typeof window.waSenderInjected === "undefined") {
  window.waSenderInjected = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // 2. POLLER: Waits for UI elements instead of crashing instantly
  async function waitForElement(selector, maxWaitTime = 8000) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitTime) {
      const element = document.querySelector(selector);
      // Ensure element exists and is visible
      if (element && element.offsetParent !== null) {
        return element;
      }
      await sleep(500);
    }
    return null;
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "EXECUTE_SEND") {
      executeWhatsAppWorkflow(request.phone, request.message)
        .then(() => sendResponse({ success: true }))
        .catch((err) => {
          // Force the error to stringify properly so it never reads "undefined" again
          const errorMsg = err?.message || String(err);
          sendResponse({ success: false, error: errorMsg });
        });

      return true; // CRITICAL: Tells Chrome to keep the port open
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

    // Support multiline messages safely
    const lines = messageText.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      document.execCommand("insertText", false, lines[i].replace(/\r/g, ""));
      if (i < lines.length - 1) {
        document.execCommand("insertLineBreak");
      }
    }

    await sleep(2000);

    // --- STEP 6: Click Send ---
    const sendBtn = document.querySelector(
      'button[aria-label="Send"], span[data-icon="send"]',
    );
    if (!sendBtn) throw new Error("Could not find 'Send' button.");
    // (sendBtn.closest("button") || sendBtn).click();

    await sleep(1500);
    return true;
  }
} else {
  console.log("WA Sender Content Script already loaded.");
}
