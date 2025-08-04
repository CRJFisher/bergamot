// PKM Extension Background Script - Navigation History Tracker
console.log("🚀 PKM Extension: Background script initialized");

// Store navigation history per tab
interface TabHistory {
  previousUrl?: string;
  currentUrl?: string;
  timestamp: number;
  previousUrlTimestamp?: number; // Track when the previous URL was set
  openerTabId?: number; // Track which tab opened this one
}

const tabHistories = new Map<number, TabHistory>();

// Track when new tabs are created (for link clicks that open in new tabs)
chrome.tabs.onCreated.addListener(async (tab) => {
  console.log(`🆕 Tab created:`, {
    tab_id: tab.id,
    opener_tab_id: tab.openerTabId,
    pending_url: tab.pendingUrl,
    url: tab.url,
  });

  // Store initial tab info even if we don't have opener info yet
  if (tab.id) {
    tabHistories.set(tab.id, {
      currentUrl: tab.url || tab.pendingUrl,
      timestamp: Date.now(),
      openerTabId: tab.openerTabId,
    });
  }

  if (tab.id && tab.openerTabId) {
    await handleTabOpener(tab.id, tab.openerTabId);
  }
});

// Handle tab updates to catch opener information that might come after creation
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // If we get opener info after tab creation
  if (tab.openerTabId && !tabHistories.get(tabId)?.openerTabId) {
    console.log(`📌 Tab ${tabId} got opener info after creation:`, {
      opener_tab_id: tab.openerTabId,
      url: tab.url,
    });
    await handleTabOpener(tabId, tab.openerTabId);
  }

  // Handle URL changes
  if (changeInfo.status === "loading" && changeInfo.url) {
    const previousEntry = tabHistories.get(tabId);
    const currentUrl = changeInfo.url;
    const now = Date.now();

    // Only update the previous URL if this is the first navigation
    // or if we're navigating to a different URL
    const shouldUpdatePreviousUrl =
      !previousEntry?.previousUrl || previousEntry.currentUrl !== currentUrl;

    tabHistories.set(tabId, {
      previousUrl: shouldUpdatePreviousUrl
        ? previousEntry?.currentUrl
        : previousEntry?.previousUrl,
      previousUrlTimestamp: shouldUpdatePreviousUrl
        ? previousEntry?.timestamp
        : previousEntry?.previousUrlTimestamp,
      currentUrl: currentUrl,
      timestamp: now,
      openerTabId: previousEntry?.openerTabId || tab.openerTabId,
    });

    console.log(`📍 Tab ${tabId} navigated to: ${currentUrl}`, {
      previous_url: previousEntry?.currentUrl,
      preserved_referrer: previousEntry?.previousUrl,
      opener: tab.openerTabId || "none",
      updated_previous: shouldUpdatePreviousUrl,
    });
  }
});

// Helper function to handle tab opener relationship
async function handleTabOpener(tabId: number, openerTabId: number) {
  console.log(`🔍 Handling tab opener relationship:`, {
    tab_id: tabId,
    opener_tab_id: openerTabId,
  });

  let openerHistory = tabHistories.get(openerTabId);
  const now = Date.now();

  // If we don't have the opener's URL in our history, query it directly
  if (!openerHistory?.currentUrl) {
    try {
      const openerTab = await chrome.tabs.get(openerTabId);
      if (openerTab.url) {
        // Update our history with the opener's current URL
        tabHistories.set(openerTabId, {
          previousUrl: openerHistory?.previousUrl,
          currentUrl: openerTab.url,
          timestamp: now,
          previousUrlTimestamp: openerHistory?.previousUrlTimestamp,
          openerTabId: openerHistory?.openerTabId,
        });
        openerHistory = tabHistories.get(openerTabId);
        console.log(`✅ Updated opener history for tab ${tabId}:`, {
          opener_url: openerTab.url,
          opener_tab_id: openerTabId,
        });
      }
    } catch (error) {
      console.warn(`Failed to get opener tab ${openerTabId}:`, error);
    }
  }

  if (openerHistory?.currentUrl) {
    // Set the opener's current URL as this tab's referrer
    const currentHistory = tabHistories.get(tabId) || {};
    tabHistories.set(tabId, {
      ...currentHistory,
      previousUrl: openerHistory.currentUrl,
      previousUrlTimestamp: openerHistory.timestamp,
      timestamp: now,
      openerTabId: openerTabId,
    });
    console.log(`✅ Set referrer for tab ${tabId}:`, {
      referrer: openerHistory.currentUrl,
      referrer_timestamp: openerHistory.timestamp,
      opener_tab_id: openerTabId,
    });
  } else {
    console.log(`⚠️  Could not determine opener URL for tab ${tabId}`);
  }
}

// Clean up when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabHistories.delete(tabId);
});

// Listen for requests from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log(
    `📨 Background received message:`,
    request.action,
    `from tab:`,
    sender.tab?.id
  );

  if (request.action === "getReferrer" && sender.tab?.id) {
    const history = tabHistories.get(sender.tab.id);
    let referrer = history?.previousUrl || "";
    let referrerTimestamp = history?.previousUrlTimestamp || Date.now();

    // Special case: if previousUrl is about:blank and we have an opener,
    // get the referrer from the opener tab instead
    if (
      history?.openerTabId &&
      (history?.previousUrl === "about:blank" ||
        history?.previousUrl === "" ||
        !history?.previousUrl)
    ) {
      const openerHistory = tabHistories.get(history.openerTabId);
      if (openerHistory?.currentUrl) {
        referrer = openerHistory.currentUrl;
        referrerTimestamp = openerHistory.timestamp;
      }
    }

    const response = {
      referrer: referrer,
      referrerTimestamp: referrerTimestamp,
    };
    console.log(`📍 Sending referrer response for tab ${sender.tab.id}:`, {
      current_url: history?.currentUrl,
      previous_url: history?.previousUrl,
      opener_tab_id: history?.openerTabId,
      computed_referrer: referrer,
      referrer_timestamp: referrerTimestamp,
      response: response,
    });
    sendResponse(response);
  } else if (request.action === "spaNavigation" && sender.tab?.id) {
    // Handle SPA navigation events
    const previousEntry = tabHistories.get(sender.tab.id);
    const now = Date.now();

    tabHistories.set(sender.tab.id, {
      previousUrl: previousEntry?.currentUrl, // The current URL becomes the previous URL
      previousUrlTimestamp: previousEntry?.timestamp, // Store the timestamp when the previous URL was current
      currentUrl: request.url,
      timestamp: now,
      openerTabId: previousEntry?.openerTabId,
    });

    console.log(
      `📍 SPA Navigation in tab ${sender.tab.id} to: ${
        request.url
      } (previous: ${previousEntry?.currentUrl || "none"})`
    );
    sendResponse({ success: true });
  } else if (request.action === "sendToPKMServer") {
    console.log(`🌐 Forwarding to PKM server:`, request.endpoint, request.data);
    // Forward the request to the PKM server and wait for response
    sendToPKMServer(request.apiBaseUrl, request.endpoint, request.data)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
  }
  return true; // Keep message channel open for async response
});

// Send POST request to the PKM server from background script
async function sendToPKMServer(
  apiBaseUrl: string,
  endpoint: string,
  data: any
): Promise<void> {
  console.log(`🚀 Making request to: ${apiBaseUrl}${endpoint}`);
  const response = await fetch(`${apiBaseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`Failed to send to ${endpoint}: ${response.status}`);
  }
  console.log(`✅ Successfully sent to ${endpoint}`);
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("PKM Extension: Installed and ready to track browsing chains");
});

export async function handleTabUpdate(
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab
) {
  // If we get opener info after tab creation
  if (tab.openerTabId && !tabHistories.get(tabId)?.openerTabId) {
    console.log(`📌 Tab ${tabId} got opener info after creation:`, {
      opener_tab_id: tab.openerTabId,
      url: tab.url,
    });
    await handleTabOpener(tabId, tab.openerTabId);
  }

  // Handle URL changes
  if (changeInfo.status === "loading" && changeInfo.url) {
    const previousEntry = tabHistories.get(tabId);
    const currentUrl = changeInfo.url;
    const now = Date.now();

    // Only update the previous URL if this is the first navigation
    // or if we're navigating to a different URL
    const shouldUpdatePreviousUrl =
      !previousEntry?.previousUrl || previousEntry.currentUrl !== currentUrl;

    tabHistories.set(tabId, {
      previousUrl: shouldUpdatePreviousUrl
        ? previousEntry?.currentUrl
        : previousEntry?.previousUrl,
      previousUrlTimestamp: shouldUpdatePreviousUrl
        ? previousEntry?.timestamp
        : previousEntry?.previousUrlTimestamp,
      currentUrl: currentUrl,
      timestamp: now,
      openerTabId: previousEntry?.openerTabId || tab.openerTabId,
    });

    console.log(`📍 Tab ${tabId} navigated to: ${currentUrl}`, {
      previous_url: previousEntry?.currentUrl,
      preserved_referrer: previousEntry?.previousUrl,
      opener: tab.openerTabId || "none",
      updated_previous: shouldUpdatePreviousUrl,
    });
  }
}

export async function handleTabRemove(tabId: number) {
  tabHistories.delete(tabId);
}

export { tabHistories };
