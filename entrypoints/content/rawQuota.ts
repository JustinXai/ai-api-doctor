// Content script for New API / One API raw quota reading
// Runs in the context of the current webpage

import type { RawQuotaBalance } from '../../src/types';

const MESSAGE_TYPE = 'GET_NEWAPI_RAW_BALANCE';
const VERIFY_MESSAGE_TYPE = 'VERIFY_NEWAPI_SITE';
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

  if (message.type === VERIFY_MESSAGE_TYPE) {
    verifyNewApiSite()
      .then((result) => {
        sendResponse({ success: true, data: result });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }
});

/**
 * Verify if this is a New API / One API console page
 * Uses page context for proper CORS and cookie handling
 */
async function verifyNewApiSite(): Promise<{ isNewApi: boolean; quotaPerUnit?: number }> {
  try {
    // Try to get userId from content script first
    let userId = getUserIdFromContentScript();

    // If not found, try to inject and get from main world
    if (!userId) {
      userId = await injectAndGetUserId();
    }

    if (!userId) {
      // No user ID found - not a valid New API console
      return { isNewApi: false, error: 'USER_NOT_FOUND' };
    }

    // User ID found, try to verify by calling the API
    const headers: Record<string, string> = {
      'accept': 'application/json, text/plain, */*',
      'cache-control': 'no-store',
      'new-api-user': userId,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch('/api/status', {
        method: 'GET',
        credentials: 'include',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // API returned error - still consider it valid if we have userId
      if (!response.ok) {
        return { isNewApi: true };
      }

      let data;
      try {
        data = await response.json();
      } catch {
        // Invalid JSON but we have userId, consider it valid
        return { isNewApi: true };
      }

      // Check for New API specific fields
      const hasNewApiFields =
        data?.data?.quota_per_unit !== undefined ||
        data?.data?.quota !== undefined ||
        data?.data?.username !== undefined;

      return {
        isNewApi: true,
        quotaPerUnit: hasNewApiFields && data.data.quota_per_unit ? Number(data.data.quota_per_unit) : undefined,
      };
    } catch {
      // Network error but we have userId, consider it valid
      return { isNewApi: true };
    }
  } catch {
    return { isNewApi: false, error: 'USER_NOT_FOUND' };
  }
}

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

  let statusData: { success?: boolean; data?: { quota_per_unit?: number } } = {};
  let selfData: { success?: boolean; data?: { quota?: number; used_quota?: number; request_count?: number; balance?: number } } = {};
  let quotaPerUnit = 500000;

  // Try different API endpoints to get quota info
  const statusEndpoints = ['/api/status', '/api/user/status', '/api/info'];
  const userEndpoints = ['/api/user/self', '/api/user/info', '/api/user', '/api/profile'];

  // Try status endpoint
  for (const endpoint of statusEndpoints) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(endpoint, {
        method: 'GET',
        credentials: 'include',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json().catch(() => null);
        if (data?.data) {
          statusData = data;
          if (data.data.quota_per_unit) {
            quotaPerUnit = Number(data.data.quota_per_unit);
          }
          break;
        }
      }
    } catch {
      // Try next endpoint
    }
  }

  // Try user info endpoint
  for (const endpoint of userEndpoints) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(endpoint, {
        method: 'GET',
        credentials: 'include',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json().catch(() => null);
        if (data?.data) {
          selfData = data;
          break;
        }
      }
    } catch {
      // Try next endpoint
    }
  }

  // Try to get quota from status data if user data doesn't have it
  let rawQuota: number | undefined;
  if (selfData?.data?.quota !== undefined) {
    rawQuota = Number(selfData.data.quota);
  } else if (statusData?.data?.quota !== undefined) {
    rawQuota = Number(statusData.data.quota);
  } else if (selfData?.data?.balance !== undefined) {
    // Some APIs use 'balance' instead of 'quota'
    rawQuota = Number(selfData.data.balance);
  }

  if (rawQuota === undefined || !Number.isFinite(rawQuota)) {
    throw new Error('QUOTA_FIELD_MISSING');
  }

  return {
    userId,
    rawQuota,
    quotaPerUnit,
    usdBalance: rawQuota / quotaPerUnit,
    usedQuota: Number(selfData.data?.used_quota || statusData.data?.used_quota || 0),
    requestCount: Number(selfData.data?.request_count || statusData.data?.request_count || 0),
    timestamp: Date.now(),
  };
}

// Export for potential direct use
export { MESSAGE_TYPE };
