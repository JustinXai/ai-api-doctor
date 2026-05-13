// Content script for New API / One API raw quota reading
// Runs in the context of the current webpage

import type { RawQuotaBalance } from '../../src/types';

const MESSAGE_TYPE = 'GET_NEWAPI_RAW_BALANCE';
const INJECTED_KEY = '__ai_api_doctor_user_id__';

// Listen for messages from popup/background
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MESSAGE_TYPE) {
    getRawBalance()
      .then((balance) => {
        sendResponse({ success: true, data: balance });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }
});

/**
 * Try to get userId from content script localStorage
 */
function getUserIdFromContentScript(): string | null {
  try {
    const userStr = localStorage.getItem('user') || '{}';
    const user = JSON.parse(userStr);
    return String(user.id || '');
  } catch {
    return null;
  }
}

/**
 * Inject script to main world to read localStorage
 * Content scripts have isolated world, so we need to inject to get access
 */
async function injectAndGetUserId(): Promise<string> {
  // Try to read from content script first
  const contentScriptUserId = getUserIdFromContentScript();
  if (contentScriptUserId) {
    return contentScriptUserId;
  }

  // Check if we already injected
  const existingId = window[INJECTED_KEY as keyof Window] as string | undefined;
  if (existingId) {
    return existingId;
  }

  // Inject a script to read localStorage from main world
  return new Promise((resolve) => {
    try {
      // Create and inject script element
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('rawQuotaInject.js');
      script.onload = () => {
        // Script loaded, now try to get the userId
        const injectedId = window[INJECTED_KEY as keyof Window] as string | undefined;
        if (injectedId) {
          resolve(injectedId);
        } else {
          // Fallback: try to read directly
          try {
            const userStr = localStorage.getItem('user') || '{}';
            const user = JSON.parse(userStr);
            const userId = String(user.id || '');
            if (userId) {
              resolve(userId);
            } else {
              resolve('');
            }
          } catch {
            resolve('');
          }
        }
        script.remove();
      };
      script.onerror = () => {
        // Try direct read as last resort
        try {
          const userStr = localStorage.getItem('user') || '{}';
          const user = JSON.parse(userStr);
          const userId = String(user.id || '');
          resolve(userId);
        } catch {
          resolve('');
        }
        script.remove();
      };
      document.head.appendChild(script);
    } catch {
      resolve('');
    }
  });
}

/**
 * Read raw quota from New API / One API console page
 */
export async function getRawBalance(): Promise<RawQuotaBalance> {
  // Get user ID with fallback to main world injection
  let userId = getUserIdFromContentScript();

  if (!userId) {
    userId = await injectAndGetUserId();
  }

  if (!userId) {
    throw new Error('USER_NOT_FOUND');
  }

  const headers: Record<string, string> = {
    'accept': 'application/json, text/plain, */*',
    'cache-control': 'no-store',
    'new-api-user': userId,
  };

  // Fetch from both endpoints in parallel
  const [statusRes, selfRes] = await Promise.all([
    fetch('/api/status', {
      method: 'GET',
      credentials: 'include',
      headers,
    }),
    fetch('/api/user/self', {
      method: 'GET',
      credentials: 'include',
      headers,
    }),
  ]);

  if (!statusRes.ok || !selfRes.ok) {
    throw new Error('API_REQUEST_FAILED');
  }

  let statusData: { success?: boolean; data?: { quota_per_unit?: number } };
  let selfData: { success?: boolean; data?: { quota?: number; used_quota?: number; request_count?: number } };

  try {
    statusData = await statusRes.json();
    selfData = await selfRes.json();
  } catch {
    throw new Error('INVALID_JSON_RESPONSE');
  }

  if (!statusData?.success || !selfData?.success) {
    throw new Error('API_RETURNED_ERROR');
  }

  const quotaPerUnit = Number(statusData.data?.quota_per_unit || 500000);
  const rawQuota = Number(selfData.data?.quota);

  if (!Number.isFinite(rawQuota)) {
    throw new Error('QUOTA_FIELD_MISSING');
  }

  return {
    userId,
    rawQuota,
    quotaPerUnit,
    usdBalance: rawQuota / quotaPerUnit,
    usedQuota: Number(selfData.data?.used_quota || 0),
    requestCount: Number(selfData.data?.request_count || 0),
    timestamp: Date.now(),
  };
}

// Export for potential direct use
export { MESSAGE_TYPE };
