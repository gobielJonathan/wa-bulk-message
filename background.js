let queue = [];
let config = {};
let stats = { sent: 0, failed: 0, total: 0 };
let isRunning = false;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "START_CAMPAIGN") {
        queue = request.payload.contacts; 
        config = request.payload;
        stats = { sent: 0, failed: 0, total: queue.length };
        
        if (!isRunning) {
            isRunning = true;
            processNextMessage();
        }
    }
});

async function processNextMessage() {
    if (queue.length === 0) {
        isRunning = false;
        return;
    }

    const currentContact = queue.shift(); 

    chrome.tabs.query({ url: "*://web.whatsapp.com/*" }, (tabs) => {
        if (tabs.length === 0) {
            console.error("WhatsApp Web is not open.");
            isRunning = false;
            return;
        }

        const waTabId = tabs[0].id;
        const payload = {
            action: "EXECUTE_SEND",
            phone: currentContact.phone,
            message: currentContact.message 
        };

        // 1. Attempt to send the message
        chrome.tabs.sendMessage(waTabId, payload, (response) => {
            
            // 2. Catch script injection failures
            if (chrome.runtime.lastError) {
                console.warn("Content script missing. Injecting dynamically...");
                
                chrome.scripting.executeScript({
                    target: { tabId: waTabId },
                    files: ["content.js"]
                }, () => {
                    if (chrome.runtime.lastError) {
                        handleResponse({ success: false, error: "Script injection failed: " + chrome.runtime.lastError.message });
                        return;
                    }
                    // Wait half a second for script to boot, then retry
                    setTimeout(() => {
                        chrome.tabs.sendMessage(waTabId, payload, handleResponse);
                    }, 500);
                });
            } else {
                handleResponse(response);
            }
        });

        function handleResponse(response) {
            if (chrome.runtime.lastError || !response || !response.success) {
                stats.failed++;
                // Fallback string if err.message doesn't exist
                const errorReason = chrome.runtime.lastError?.message || response?.error || "Unknown Error/Port Closed";
                console.error(`Failed to send to ${currentContact.phone}:`, errorReason);
            } else {
                stats.sent++;
            }

            // Send progress to popup. The empty callback catches the "Unchecked runtime" error if popup is closed!
            chrome.runtime.sendMessage({
                action: "UPDATE_PROGRESS",
                sent: stats.sent,
                failed: stats.failed,
                total: stats.total
            }, () => {
                if (chrome.runtime.lastError) { /* Ignore popup closed errors */ }
            });

            // Delay next message
            const delay = Math.floor(Math.random() * (config.maxDelay - config.minDelay + 1)) + config.minDelay;
            setTimeout(processNextMessage, delay);
        }
    });
}