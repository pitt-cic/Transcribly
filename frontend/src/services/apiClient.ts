import { getCurrentSession } from './authService';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

interface RequestOptions extends RequestInit {
  requiresAuth?: boolean;
}

/**
 * API client that automatically includes authentication tokens
 */
export const apiClient = async (
  endpoint: string,
  options: RequestOptions = {}
): Promise<Response> => {
  const { requiresAuth = true, headers = {}, ...fetchOptions } = options;

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers as Record<string, string>),
  };

  // Add auth token if required
  if (requiresAuth) {
    try {
      const session = await getCurrentSession();
      // Use ID token for Cognito User Pool authorizer (not access token)
      const token = session.getIdToken().getJwtToken();
      requestHeaders['Authorization'] = `Bearer ${token}`;
    } catch (err) {
      throw new Error('Authentication required');
    }
  }

  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    ...fetchOptions,
    headers: requestHeaders,
  });

  return response;
};

/**
 * Convenience methods for common HTTP verbs
 */
export const api = {
  get: (endpoint: string, options?: RequestOptions) =>
    apiClient(endpoint, { ...options, method: 'GET' }),

  post: (endpoint: string, data?: any, options?: RequestOptions) =>
    apiClient(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }),

  put: (endpoint: string, data?: any, options?: RequestOptions) =>
    apiClient(endpoint, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    }),

  delete: (endpoint: string, options?: RequestOptions) =>
    apiClient(endpoint, { ...options, method: 'DELETE' }),

  patch: (endpoint: string, data?: any, options?: RequestOptions) =>
    apiClient(endpoint, {
      ...options,
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    }),
};

/**
 * Upload file with auth token
 */
export const uploadFile = async (
  endpoint: string,
  file: File,
  additionalData?: Record<string, string>
): Promise<Response> => {
  try {
    const session = await getCurrentSession();
    const token = session.getAccessToken().getJwtToken();

    const formData = new FormData();
    formData.append('file', file);

    if (additionalData) {
      Object.entries(additionalData).forEach(([key, value]) => {
        formData.append(key, value);
      });
    }

    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;

    return await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: formData,
    });
  } catch (err) {
    throw new Error('Authentication required for file upload');
  }
};
