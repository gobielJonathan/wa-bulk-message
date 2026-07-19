import "./style.css";

let excelData = [];
let activeCampaignId = null;
let activeCampaignStatus = null;

const processingSection = document.getElementById("processingSection");
const uploadSection = document.getElementById("uploadSection");
const processingBody = document.getElementById("processingBody");
const terminateAllBtn = document.getElementById("terminateAllBtn");
const statusText = document.getElementById("statusText");

function hasActiveCampaign(campaigns) {
  return Object.values(campaigns).some(
    (c) => c.campaignStatus === "running" || c.campaignStatus === "paused"
  );
}

function toggleUploadSection(disabled) {
  if (disabled) {
    uploadSection.classList.add("disabled");
  } else {
    uploadSection.classList.remove("disabled");
  }
}

function renderProcessingTable(campaigns) {
  const entries = Object.values(campaigns);
  if (entries.length === 0) {
    processingSection.style.display = "none";
    toggleUploadSection(false);
    return;
  }

  processingSection.style.display = "block";
  const hasActive = hasActiveCampaign(campaigns);
  toggleUploadSection(hasActive);

  const c = entries[0];
  activeCampaignId = c.id;
  activeCampaignStatus = c.campaignStatus;

  const isPaused = c.campaignStatus === "paused";

  let html = "";
  c.contacts.forEach((contact, i) => {
    const statusClass = contact.status;
    const statusLabel =
      contact.status === "done"
        ? "done"
        : contact.status === "running"
        ? "running"
        : contact.status === "failed"
        ? "failed"
        : "pending";

    let actHtml = "";
    if (contact.status === "done") {
      actHtml = '<span class="check-icon">&#10003;</span>';
    } else if (contact.status === "failed") {
      actHtml = `<button class="act-btn retry-btn" data-action="retry" data-index="${i}" title="Retry">&#8635;</button>`;
    } else if (contact.status === "running" || contact.status === "pending") {
      if (isPaused) {
        actHtml = `<button class="act-btn play-btn" data-action="resume" title="Resume">&#9654;</button>`;
      } else {
        actHtml = `<button class="act-btn pause-btn" data-action="pause" title="Pause">&#9208;</button>`;
      }
    }

    html += `<tr>
      <td>${i + 1}</td>
      <td>${contact.NIM || "-"}</td>
      <td>${contact.phone}</td>
      <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
      <td>${actHtml}</td>
    </tr>`;
  });

  processingBody.innerHTML = html;

  document.getElementById("sentCount").innerText = c.stats.sent;
  document.getElementById("failCount").innerText = c.stats.failed;
  document.getElementById("totalCount").innerText = c.stats.total;

  if (c.campaignStatus === "completed") {
    statusText.innerText = `Campaign done. Sent: ${c.stats.sent}, Failed: ${c.stats.failed}/${c.stats.total}`;
  } else if (isPaused) {
    statusText.innerText = "Campaign paused.";
  } else {
    statusText.innerText = `Processing: ${c.stats.sent + c.stats.failed}/${c.stats.total}`;
  }
}

chrome.runtime.sendMessage({ action: "GET_CAMPAIGNS" }, (response) => {
  if (response && response.campaigns && Object.keys(response.campaigns).length > 0) {
    renderProcessingTable(response.campaigns);
  }
});

document.getElementById("excelFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const data = new Uint8Array(e.target.result);
    const workbook = XLSX.read(data, { type: "array" });
    const json = XLSX.utils.sheet_to_json(
      workbook.Sheets[workbook.SheetNames[0]]
    );

    excelData = json
      .map((row) => {
        const phone = row["Phone"] || row["phone"] || row["phone number"];
        const msg = row["Message"] || row["message"] || row["template message"];
        const NIM = row["NIM"] || row["nim"];

        return {
          phone: String(phone).replace(/\D/g, ""),
          message: msg,
          NIM,
        };
      })
      .filter((row) => [row.phone, row.message, row.NIM].filter(Boolean).length > 0);

    document.getElementById("totalCount").innerText = excelData.length;
    statusText.innerText = "File loaded. Ready to send.";
    document.getElementById("startBtn").disabled = excelData.length === 0;
  };
  reader.readAsArrayBuffer(file);
});

document.getElementById("startBtn").addEventListener("click", () => {
  const minDelay = parseInt(document.getElementById("minDelay").value) * 1000;
  const maxDelay = parseInt(document.getElementById("maxDelay").value) * 1000;

  chrome.runtime.sendMessage(
    {
      action: "START_CAMPAIGN",
      payload: { minDelay, maxDelay, contacts: excelData },
    },
    (response) => {
      if (response && response.campaignId) {
        activeCampaignId = response.campaignId;
        activeCampaignStatus = "running";
        toggleUploadSection(true);
        statusText.innerText = "Campaign started! Do not close WhatsApp tab.";
        document.getElementById("startBtn").disabled = true;
      }
    }
  );
});

processingBody.addEventListener("click", (e) => {
  const btn = e.target.closest(".act-btn");
  if (!btn) return;

  const action = btn.dataset.action;
  const index = btn.dataset.index;

  if (action === "pause") {
    chrome.runtime.sendMessage({
      action: "PAUSE_CAMPAIGN",
      campaignId: activeCampaignId,
    });
  } else if (action === "resume") {
    chrome.runtime.sendMessage({
      action: "RESUME_CAMPAIGN",
      campaignId: activeCampaignId,
    });
  } else if (action === "retry") {
    chrome.runtime.sendMessage({
      action: "RETRY_CONTACT",
      campaignId: activeCampaignId,
      contactIndex: parseInt(index),
    });
  }
});

terminateAllBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "TERMINATE_ALL" });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "UPDATE_PROGRESS") {
    const campaigns = { [msg.campaignId]: { id: msg.campaignId, contacts: msg.contacts, stats: msg.stats, campaignStatus: msg.campaignStatus } };
    renderProcessingTable(campaigns);
  }

  if (msg.action === "ALL_TERMINATED") {
    processingSection.style.display = "none";
    toggleUploadSection(false);
    activeCampaignId = null;
    activeCampaignStatus = null;
    document.getElementById("startBtn").disabled = false;
    statusText.innerText = "All campaigns terminated.";
    document.getElementById("sentCount").innerText = 0;
    document.getElementById("failCount").innerText = 0;
    document.getElementById("totalCount").innerText = 0;
  }
});
