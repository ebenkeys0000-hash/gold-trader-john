import { 
  SiteContentItem, 
  ProgramItem, 
  ContactItem, 
  FaqItem, 
  GlobalSettings, 
  ApplicationData, 
  AuditLogEntry, 
  AdminStats,
  SystemIntegrationStatus,
  SystemConfigAudit,
  AdvertisementItem
} from '../types';

const CACHE_KEY_CONTENT = 'gtj_cms_content_cache';
const CACHE_KEY_PROGRAMS = 'gtj_cms_programs_cache';
const CACHE_KEY_CONTACTS = 'gtj_cms_contacts_cache';
const CACHE_KEY_FAQ = 'gtj_cms_faq_cache';
const CACHE_KEY_SETTINGS = 'gtj_cms_settings_cache';

let currentAuthToken: string | null = null;

// Allow storing session token in memory for API calls (in addition to HttpOnly cookie)
export const setAuthToken = (token: string | null) => {
  currentAuthToken = token;
};

export const getAuthToken = (): string | null => {
  return currentAuthToken;
};

const getAuthHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  if (currentAuthToken) {
    headers['Authorization'] = `Bearer ${currentAuthToken}`;
  }
  return headers;
};

/**
 * Safe fetch wrapper that:
 * 1. Sends credentials: 'include' for HttpOnly cookie session support
 * 2. Checks response.ok BEFORE calling response.json()
 * 3. Inspects response Content-Type header to ensure JSON
 * 4. Extracts useful error messages from JSON or text without dumping HTML tags
 * 5. NEVER throws "Unexpected token 'T', ... is not valid JSON"
 */
async function safeFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const authHeaders = currentAuthToken ? { 'Authorization': `Bearer ${currentAuthToken}` } : {};
  const mergedOptions: RequestInit = {
    credentials: 'include',
    ...options,
    headers: {
      'Accept': 'application/json',
      ...authHeaders,
      ...(options?.headers || {})
    }
  };

  let res: Response;
  try {
    res = await fetch(url, mergedOptions);
  } catch (networkError: any) {
    throw new Error(`Network connection error: ${networkError?.message || 'Unable to connect to the server'}`);
  }

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.toLowerCase().includes('application/json');

  // If HTTP status is NOT ok (e.g. 400, 401, 403, 404, 500, 503)
  if (!res.ok) {
    let errorMessage = `Server returned HTTP ${res.status}`;

    if (isJson) {
      try {
        const errorData = await res.json();
        errorMessage = errorData?.error || errorData?.message || errorMessage;
      } catch {
        errorMessage = `Server returned HTTP ${res.status} (${res.statusText || 'Error'})`;
      }
    } else {
      // Non-JSON response (e.g. Vercel 404 "The page could not be found" or HTML error page)
      try {
        const text = await res.text();
        if (text && text.trim().length > 0) {
          if (text.includes('<!DOCTYPE') || text.includes('<html') || text.includes('The page could not be found')) {
            errorMessage = `API endpoint unavailable (${res.status} ${res.statusText || 'Not Found'}). The requested backend route could not be reached.`;
          } else {
            const cleanText = text.trim();
            errorMessage = cleanText.length > 200 ? `${cleanText.slice(0, 200)}...` : cleanText;
          }
        }
      } catch {
        // Fallback to HTTP status
      }
    }

    throw new Error(errorMessage);
  }

  // If HTTP status is OK (200-299) but content is NOT JSON (e.g., SPA rewrite returning index.html)
  if (!isJson) {
    let isHtml = false;
    try {
      const text = await res.text();
      isHtml = text.includes('<!DOCTYPE') || text.includes('<html');
    } catch {
      // Ignore
    }

    if (isHtml) {
      throw new Error(`API configuration error: endpoint ${url} returned an HTML page instead of JSON. Ensure the server or Vercel serverless function is configured.`);
    }

    throw new Error(`Invalid response format from ${url}: expected application/json, received '${contentType || 'unknown'}'.`);
  }

  // Safely parse JSON
  try {
    const data = await res.json();
    return data as T;
  } catch (parseError: any) {
    throw new Error(`Failed to parse response from server (${url}): ${parseError?.message || 'Invalid JSON syntax'}`);
  }
}

export const cmsApi = {
  // Public Data
  async fetchContent(): Promise<{ data: SiteContentItem[]; map: Record<string, string> }> {
    try {
      const res = await safeFetch<{ success: boolean; data: SiteContentItem[]; map: Record<string, string> }>('/api/content');
      localStorage.setItem(CACHE_KEY_CONTENT, JSON.stringify(res));
      return res;
    } catch (e) {
      const cached = localStorage.getItem(CACHE_KEY_CONTENT);
      if (cached) return JSON.parse(cached);
      throw e;
    }
  },

  async fetchPrograms(): Promise<ProgramItem[]> {
    try {
      const res = await safeFetch<{ success: boolean; data: ProgramItem[] }>('/api/programs');
      localStorage.setItem(CACHE_KEY_PROGRAMS, JSON.stringify(res.data));
      return res.data;
    } catch (e) {
      const cached = localStorage.getItem(CACHE_KEY_PROGRAMS);
      if (cached) return JSON.parse(cached);
      throw e;
    }
  },

  async fetchContacts(): Promise<ContactItem[]> {
    try {
      const res = await safeFetch<{ success: boolean; data: ContactItem[] }>('/api/contacts');
      localStorage.setItem(CACHE_KEY_CONTACTS, JSON.stringify(res.data));
      return res.data;
    } catch (e) {
      const cached = localStorage.getItem(CACHE_KEY_CONTACTS);
      if (cached) return JSON.parse(cached);
      throw e;
    }
  },

  async fetchFaq(): Promise<FaqItem[]> {
    try {
      const res = await safeFetch<{ success: boolean; data: FaqItem[] }>('/api/faq');
      localStorage.setItem(CACHE_KEY_FAQ, JSON.stringify(res.data));
      return res.data;
    } catch (e) {
      const cached = localStorage.getItem(CACHE_KEY_FAQ);
      if (cached) return JSON.parse(cached);
      throw e;
    }
  },

  async fetchSettings(): Promise<GlobalSettings> {
    try {
      const res = await safeFetch<{ success: boolean; data: GlobalSettings }>('/api/settings');
      localStorage.setItem(CACHE_KEY_SETTINGS, JSON.stringify(res.data));
      return res.data;
    } catch (e) {
      const cached = localStorage.getItem(CACHE_KEY_SETTINGS);
      if (cached) return JSON.parse(cached);
      throw e;
    }
  },

  async submitApplication(appData: any): Promise<{ success: boolean; applicationId: string; message: string }> {
    return safeFetch('/api/applications', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(appData)
    });
  },

  // Admin Auth Status check
  async checkAuthStatus(): Promise<{ configured: boolean; error?: string }> {
    try {
      const res = await safeFetch<{ success: boolean; configured: boolean }>('/api/admin/auth-status');
      return { configured: Boolean(res.configured) };
    } catch (err: any) {
      return { configured: false, error: err.message };
    }
  },

  // Configuration Audit (Public & Safe)
  async getConfigAudit(): Promise<SystemConfigAudit> {
    const res = await safeFetch<{ success: boolean } & SystemConfigAudit>('/api/system/config-status');
    return {
      timestamp: res.timestamp,
      nodeEnv: res.nodeEnv,
      adminAuthConfigured: res.adminAuthConfigured,
      googleSheetsUrlConfigured: res.googleSheetsUrlConfigured,
      appsScriptSecretConfigured: res.appsScriptSecretConfigured,
      variables: res.variables || []
    };
  },

  async login(password: string, email?: string): Promise<{ success: boolean; user: any; message?: string; token?: string }> {
    const res = await safeFetch<{ success: boolean; user: any; message?: string; token?: string }>('/api/admin/login', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ password, email })
    });
    if (res.success && res.token) {
      setAuthToken(res.token);
    }
    return res;
  },

  async checkAuth(): Promise<{ success: boolean; user: any }> {
    return safeFetch('/api/admin/me', {
      headers: getAuthHeaders()
    });
  },

  async logout(): Promise<void> {
    try {
      await safeFetch('/api/admin/logout', {
        method: 'POST',
        headers: getAuthHeaders()
      });
    } finally {
      setAuthToken(null);
    }
  },

  // Admin Operations
  async fetchStats(): Promise<AdminStats> {
    const res = await safeFetch<{ success: boolean; data: AdminStats }>('/api/admin/stats', {
      headers: getAuthHeaders()
    });
    return res.data;
  },

  async fetchApplications(): Promise<ApplicationData[]> {
    const res = await safeFetch<{ success: boolean; data: ApplicationData[] }>('/api/admin/applications', {
      headers: getAuthHeaders()
    });
    return res.data;
  },

  async updateApplication(id: string, updates: Partial<ApplicationData>): Promise<ApplicationData> {
    const res = await safeFetch<{ success: boolean; data: ApplicationData }>('/api/admin/applications/' + id, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(updates)
    });
    return res.data;
  },

  async deleteApplication(id: string): Promise<void> {
    await safeFetch('/api/admin/applications/' + id, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
  },

  async updateContent(field_key: string, content: string): Promise<SiteContentItem> {
    const res = await safeFetch<{ success: boolean; data: SiteContentItem; message: string }>('/api/admin/content', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ field_key, content })
    });
    return res.data;
  },

  async updateProgram(key: string, updates: Partial<ProgramItem>): Promise<ProgramItem> {
    const res = await safeFetch<{ success: boolean; data: ProgramItem; message: string }>('/api/admin/programs/' + key, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(updates)
    });
    return res.data;
  },

  async updateContact(type: string, updates: Partial<ContactItem>): Promise<ContactItem> {
    const res = await safeFetch<{ success: boolean; data: ContactItem; message: string }>('/api/admin/contacts/' + type, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(updates)
    });
    return res.data;
  },

  async saveFaq(faq: Partial<FaqItem>): Promise<FaqItem> {
    const isEdit = Boolean(faq.id);
    const url = isEdit ? `/api/admin/faq/${faq.id}` : '/api/admin/faq';
    const method = isEdit ? 'PUT' : 'POST';
    const res = await safeFetch<{ success: boolean; data: FaqItem; message: string }>(url, {
      method,
      headers: getAuthHeaders(),
      body: JSON.stringify(faq)
    });
    return res.data;
  },

  async deleteFaq(id: string): Promise<void> {
    await safeFetch(`/api/admin/faq/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
  },

  async updateSettings(settings: Partial<GlobalSettings>): Promise<GlobalSettings> {
    const res = await safeFetch<{ success: boolean; data: GlobalSettings; message: string }>('/api/admin/settings', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(settings)
    });
    return res.data;
  },

  async fetchAuditLogs(): Promise<AuditLogEntry[]> {
    const res = await safeFetch<{ success: boolean; data: AuditLogEntry[] }>('/api/admin/audit-log', {
      headers: getAuthHeaders()
    });
    return res.data;
  },

  async testGoogleSheets(url?: string): Promise<{ success: boolean; message: string; data?: any }> {
    return safeFetch('/api/admin/google-sheets/test', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ url })
    });
  },

  async syncGoogleSheets(url?: string): Promise<{ success: boolean; message: string; count?: number }> {
    return safeFetch('/api/admin/google-sheets/sync', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ url })
    });
  },

  async fetchScriptCode(): Promise<string> {
    const res = await safeFetch<{ success: boolean; code: string }>('/api/admin/google-sheets/script-code', {
      headers: getAuthHeaders()
    });
    return res.code;
  },

  async fetchSystemStatus(): Promise<SystemIntegrationStatus> {
    const res = await safeFetch<{ success: boolean; status: SystemIntegrationStatus }>('/api/admin/system/status', {
      headers: getAuthHeaders()
    });
    return res.status;
  },

  async testSystemConnection(): Promise<{ success: boolean; status: SystemIntegrationStatus; message: string }> {
    return safeFetch('/api/admin/system/test-connection', {
      method: 'POST',
      headers: getAuthHeaders()
    });
  },

  // Advertisements (Public)
  async fetchAds(placement?: string): Promise<AdvertisementItem[]> {
    try {
      const url = placement ? `/api/ads?placement=${encodeURIComponent(placement)}` : '/api/ads';
      const res = await safeFetch<{ success: boolean; data: AdvertisementItem[] }>(url);
      return res.data;
    } catch {
      return [];
    }
  },

  async recordAdImpression(id: string): Promise<void> {
    try {
      await safeFetch(`/api/ads/${encodeURIComponent(id)}/impression`, {
        method: 'POST'
      });
    } catch {
      // Non-blocking
    }
  },

  async recordAdClick(id: string): Promise<void> {
    try {
      await safeFetch(`/api/ads/${encodeURIComponent(id)}/click`, {
        method: 'POST'
      });
    } catch {
      // Non-blocking
    }
  },

  // Advertisements (Admin Protected)
  async adminFetchAds(): Promise<AdvertisementItem[]> {
    const res = await safeFetch<{ success: boolean; data: AdvertisementItem[] }>('/api/admin/ads', {
      headers: getAuthHeaders()
    });
    return res.data;
  },

  async adminCreateAd(adData: Partial<AdvertisementItem>): Promise<AdvertisementItem> {
    const res = await safeFetch<{ success: boolean; data: AdvertisementItem; message: string }>('/api/admin/ads', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(adData)
    });
    return res.data;
  },

  async adminUpdateAd(id: string, updates: Partial<AdvertisementItem>): Promise<AdvertisementItem> {
    const res = await safeFetch<{ success: boolean; data: AdvertisementItem; message: string }>(`/api/admin/ads/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(updates)
    });
    return res.data;
  },

  async adminDeleteAd(id: string): Promise<void> {
    await safeFetch(`/api/admin/ads/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
  }
};
