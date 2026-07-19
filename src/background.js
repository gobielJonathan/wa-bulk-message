let campaigns = {};
let campaignTimers = {};

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function persistCampaigns() {
  const data = {};
  for (const [id, c] of Object.entries(campaigns)) {
    data[id] = {
      id: c.id,
      contacts: c.contacts,
      config: c.config,
      campaignStatus: c.campaignStatus,
      stats: c.stats,
    };
  }
  chrome.storage.session.set({ campaigns: data });
}

function loadCampaigns(cb) {
  chrome.storage.session.get("campaigns", (result) => {
    if (result.campaigns) {
      campaigns = result.campaigns;
      for (const c of Object.values(campaigns)) {
        c.shouldStop = c.campaignStatus === "paused";
      }
    }
    cb();
  });
}

function broadcastUpdate(campaignId) {
  const c = campaigns[campaignId];
  if (!c) return;
  chrome.runtime.sendMessage({
    action: "UPDATE_PROGRESS",
    campaignId,
    contacts: c.contacts,
    stats: c.stats,
    campaignStatus: c.campaignStatus,
  }, () => { if (chrome.runtime.lastError) {} });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "START_CAMPAIGN") {
    const id = generateId();
    const contacts = request.payload.contacts.map((c) => ({
      phone: c.phone,
      NIM: c.NIM,
      message: c.message,
      status: "pending",
    }));

    campaigns[id] = {
      id,
      contacts,
      config: request.payload,
      stats: { sent: 0, failed: 0, total: contacts.length },
      campaignStatus: "running",
      shouldStop: false,
    };

    persistCampaigns();
    sendResponse({ campaignId: id });
    processNextMessage(id);
    return true;
  }

  if (request.action === "PAUSE_CAMPAIGN") {
    const c = campaigns[request.campaignId];
    if (c) {
      c.campaignStatus = "paused";
      c.shouldStop = true;
      persistCampaigns();
      broadcastUpdate(request.campaignId);
    }
    sendResponse({ ok: true });
    return true;
  }

  if (request.action === "RESUME_CAMPAIGN") {
    const c = campaigns[request.campaignId];
    if (c && c.campaignStatus === "paused") {
      c.campaignStatus = "running";
      c.shouldStop = false;
      persistCampaigns();
      broadcastUpdate(request.campaignId);
      processNextMessage(request.campaignId);
    }
    sendResponse({ ok: true });
    return true;
  }

  if (request.action === "RETRY_CONTACT") {
    const c = campaigns[request.campaignId];
    if (c) {
      const contact = c.contacts[request.contactIndex];
      if (contact && contact.status === "failed") {
        contact.status = "pending";
        c.stats.failed = c.contacts.filter((x) => x.status === "failed").length;
        c.stats.sent = c.contacts.filter((x) => x.status === "done").length;
        persistCampaigns();
        broadcastUpdate(request.campaignId);
        if (c.campaignStatus === "paused") {
          c.campaignStatus = "running";
          c.shouldStop = false;
          persistCampaigns();
          processNextMessage(request.campaignId);
        }
      }
    }
    sendResponse({ ok: true });
    return true;
  }

  if (request.action === "TERMINATE_ALL") {
    for (const c of Object.values(campaigns)) {
      c.shouldStop = true;
      c.campaignStatus = "completed";
    }
    campaigns = {};
    chrome.storage.session.remove("campaigns");
    chrome.runtime.sendMessage({ action: "ALL_TERMINATED" }, () => {
      if (chrome.runtime.lastError) {}
    });
    chrome.tabs.query({ url: "*://web.whatsapp.com/*" }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "ABORT_SEND" }, () => {
          if (chrome.runtime.lastError) {}
        });
      }
    });
    sendResponse({ ok: true });
    return true;
  }

  if (request.action === "GET_CAMPAIGNS") {
    const result = {};
    for (const [id, c] of Object.entries(campaigns)) {
      result[id] = {
        id: c.id,
        contacts: c.contacts,
        config: c.config,
        stats: c.stats,
        campaignStatus: c.campaignStatus,
      };
    }
    sendResponse({ campaigns: result });
    return true;
  }
});

async function processNextMessage(campaignId) {
  const c = campaigns[campaignId];
  if (!c || c.shouldStop || c.campaignStatus !== "running") {
    return;
  }

  const nextIndex = c.contacts.findIndex((x) => x.status === "pending");
  if (nextIndex === -1) {
    c.campaignStatus = "completed";
    persistCampaigns();
    broadcastUpdate(campaignId);
    return;
  }

  const currentContact = c.contacts[nextIndex];
  currentContact.status = "running";
  broadcastUpdate(campaignId);

  chrome.tabs.query({ url: "*://web.whatsapp.com/*" }, (tabs) => {
    if (tabs.length === 0) {
      currentContact.status = "failed";
      c.stats.failed++;
      persistCampaigns();
      broadcastUpdate(campaignId);
      return;
    }

    if (c.shouldStop) {
      currentContact.status = "pending";
      return;
    }

    const waTabId = tabs[0].id;
    const payload = {
      action: "EXECUTE_SEND",
      phone: currentContact.phone,
      message: currentContact.message,
    };

    chrome.tabs.sendMessage(waTabId, payload, (response) => {
      if (chrome.runtime.lastError) {
        chrome.scripting.executeScript(
          { target: { tabId: waTabId }, files: ["content.js"] },
          () => {
            if (chrome.runtime.lastError) {
              handleSendResult(campaignId, nextIndex, false, "Script injection failed");
              return;
            }
            setTimeout(() => {
              chrome.tabs.sendMessage(waTabId, payload, (r2) => {
                handleSendResult(
                  campaignId,
                  nextIndex,
                  r2 && r2.success,
                  r2 ? r2.error : "No response"
                );
              });
            }, 500);
          }
        );
      } else {
        handleSendResult(
          campaignId,
          nextIndex,
          response && response.success,
          response ? response.error : "No response"
        );
      }
    });
  });
}

function handleSendResult(campaignId, contactIndex, success, error) {
  const c = campaigns[campaignId];
  if (!c) return;

  if (c.shouldStop) {
    c.contacts[contactIndex].status = "pending";
    return;
  }

  if (success) {
    c.contacts[contactIndex].status = "done";
    c.stats.sent++;
  } else {
    c.contacts[contactIndex].status = "failed";
    c.stats.failed++;
    console.error(`Failed: ${c.contacts[contactIndex].phone}:`, error);
  }

  persistCampaigns();
  broadcastUpdate(campaignId);

  const delay =
    Math.floor(Math.random() * (c.config.maxDelay - c.config.minDelay + 1)) +
    c.config.minDelay;
  campaignTimers[campaignId] = setTimeout(() => processNextMessage(campaignId), delay);
}

loadCampaigns(() => {
  for (const c of Object.values(campaigns)) {
    if (c.campaignStatus === "running") {
      processNextMessage(c.id);
    }
  }
});
