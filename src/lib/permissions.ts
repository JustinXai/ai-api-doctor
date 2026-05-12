/**
 * permissions.ts
 *
 * AI API Doctor — Runtime host permission management.
 * Requests permission for the user's custom API Base URL origin
 * before making network requests. Keeps the extension minimal.
 */

export interface PermissionResult {
  granted: boolean;
  origin: string;
  reason?: string;
}

/**
 * Extract the origin from a Base URL.
 * e.g. "https://api.example.com/v1" → "https://api.example.com/*"
 */
export function getOriginFromBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return `${url.origin}/*`;
  } catch {
    // Try with a normalized version
    const normalized = normalizeBaseUrl(baseUrl);
    try {
      const url = new URL(normalized);
      return `${url.origin}/*`;
    } catch {
      return baseUrl;
    }
  }
}

function normalizeBaseUrl(raw: string): string {
  let url = raw.trim();
  url = url.replace(/\/+$/, '');
  url = url.replace(/\/v1\/v1(\/|$)/, '/v1$1');
  if (!url.endsWith('/v1')) {
    url = url + '/v1';
  }
  return url;
}

/**
 * Ensure the extension has host permission for the given Base URL.
 *
 * Flow:
 * 1. Derive origin from baseUrl.
 * 2. Check if permission is already granted via chrome.permissions.contains.
 * 3. If not, request it via chrome.permissions.request.
 * 4. If chrome.permissions is not available (dev/edge case), return granted=true as fallback.
 * 5. If user denies, return granted=false.
 *
 * @returns PermissionResult with granted flag, origin, and optional reason
 */
export async function ensureHostPermission(baseUrl: string): Promise<PermissionResult> {
  const origin = getOriginFromBaseUrl(baseUrl);

  // Check if chrome.permissions API is available (not available in all contexts)
  if (typeof chrome === 'undefined' || !chrome.permissions) {
    // Fallback: no permission API, assume granted
    return { granted: true, origin };
  }

  try {
    // Check current permission state
    const hasPermission = await new Promise<boolean>((resolve) => {
      chrome.permissions.contains({ origins: [origin] }, (result) => {
        resolve(!!result);
      });
    });

    if (hasPermission) {
      return { granted: true, origin };
    }

    // Request permission from user
    const granted = await new Promise<boolean>((resolve) => {
      chrome.permissions.request({ origins: [origin] }, (result) => {
        // result is false if user denied or API error
        resolve(!!result);
      });
    });

    if (granted) {
      return { granted: true, origin };
    } else {
      return {
        granted: false,
        origin,
        reason: 'permission_denied',
      };
    }
  } catch (err) {
    // API error — fallback to granted to not block dev/testing
    console.warn('[permissions] chrome.permissions API error:', err);
    return { granted: true, origin };
  }
}

/**
 * Check if the extension currently has permission for a given base URL.
 */
export async function hasHostPermission(baseUrl: string): Promise<boolean> {
  const origin = getOriginFromBaseUrl(baseUrl);

  if (typeof chrome === 'undefined' || !chrome.permissions) {
    return true;
  }

  try {
    return await new Promise<boolean>((resolve) => {
      chrome.permissions.contains({ origins: [origin] }, (result) => {
        resolve(!!result);
      });
    });
  } catch {
    return true;
  }
}
