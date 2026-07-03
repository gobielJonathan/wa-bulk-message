let excelData = [];

document.getElementById("excelFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const data = new Uint8Array(e.target.result);
    const workbook = XLSX.read(data, { type: "array" });
    const json = XLSX.utils.sheet_to_json(
      workbook.Sheets[workbook.SheetNames[0]],
    );

    excelData = json
      .map((row) => {
        // Now only looking for "Phone" and "Message"
        const phone = row["Phone"] || row["phone"] || row["phone number"];
        const msg = row["Message"] || row["message"] || row["template message"];

        return {
          phone: String(phone).replace(/\D/g, ""),
          message: msg,
        };
      })
      .filter((row) => row.phone && row.message);

    document.getElementById("totalCount").innerText = excelData.length;

    document.getElementById("statusText").innerText =
      "File loaded. Ready to send.";
    document.getElementById("startBtn").disabled = excelData.length === 0;
  };
  reader.readAsArrayBuffer(file);
});

document.getElementById("startBtn").addEventListener("click", () => {
  const minDelay = parseInt(document.getElementById("minDelay").value) * 1000;
  const maxDelay = parseInt(document.getElementById("maxDelay").value) * 1000;

  chrome.runtime.sendMessage({
    action: "START_CAMPAIGN",
    data: excelData,
    payload: { minDelay, maxDelay, contacts: excelData, },
  });

  document.getElementById("startBtn").disabled = true;
  document.getElementById("statusText").innerText =
    "Campaign started! Do not close WhatsApp tab.";
});

// Update UI progressively
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "UPDATE_PROGRESS") {
    document.getElementById("sentCount").innerText = msg.sent;
    document.getElementById("failCount").innerText = msg.failed;
    document.getElementById("statusText").innerText =
      `Processing: ${msg.sent}/${msg.total}`;
  }
  if (msg.action === "CAMPAIGN_FINISHED") {
    document.getElementById("statusText").innerText = "Campaign Finished!";
  }
});
