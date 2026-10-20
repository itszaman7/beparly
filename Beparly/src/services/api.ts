export type Account = {
  user: { id: number; name: string; phone: string };
  business: { id: number; name: string };
  role: 'owner' | 'employee';
};

export type BusinessProfile = Account['business'] & { role: Account['role'] };
export type AuthResult = { token: string; user: Account['user']; businesses: BusinessProfile[] };
export type Employee = { id: number; name: string; phone: string; can_manage_locations: boolean; can_post_stock: boolean };
export type StockLocation = {
  id: number;
  business_id: number;
  name: string;
  type: 'shop' | 'warehouse';
  address: string;
  is_default: boolean;
  is_active: boolean;
};
export type LocationInput = { name: string; type: StockLocation['type']; address: string };

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, method: 'GET' | 'POST' | 'PATCH', data?: object, token?: string): Promise<T> {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new ApiError('API address is missing from this Expo session. Reload the app from the Beparly project.', 0);
  }
  if (!__DEV__ && !baseUrl.startsWith('https://')) {
    throw new ApiError('EXPO_PUBLIC_API_URL must use HTTPS outside development.', 0);
  }
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1/${path}`, {
      method,
      headers: {
        ...(data ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  } catch {
    throw new ApiError('Could not reach Beparly. Check your connection and API address.', 0);
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(result?.error?.message ?? 'Something went wrong. Please try again.', response.status);
  }
  if (!result) throw new ApiError('The server returned an unexpected response.', response.status);
  return result as T;
}

export const api = {
  register: (data: { username?: string; phone: string; password: string }) =>
    request<AuthResult>('auth/register/', 'POST', data),
  login: (data: { phone: string; password: string }) => request<AuthResult>('auth/login/', 'POST', data),
  me: (token: string) => request<Omit<AuthResult, 'token'>>('auth/me/', 'GET', undefined, token),
  logout: (token: string) => request<{ ok: boolean }>('auth/logout/', 'POST', {}, token),
  businesses: (token: string) => request<{ user: Account['user']; businesses: BusinessProfile[] }>('businesses/', 'GET', undefined, token),
  createBusiness: (token: string, name: string) => request<{ business: BusinessProfile }>('businesses/', 'POST', { name }, token),
  employees: (token: string, businessId: number) => request<{ employees: Employee[] }>(`businesses/${businessId}/employees/`, 'GET', undefined, token),
  createEmployee: (token: string, businessId: number, data: { username?: string; phone: string; password: string }) =>
    request<{ employee: Employee }>(`businesses/${businessId}/employees/`, 'POST', data, token),
  setLocationPermission: (token: string, businessId: number, userId: number, enabled: boolean) =>
    request<{ employee: Employee }>(`businesses/${businessId}/employees/${userId}/permissions/`, 'PATCH', { can_manage_locations: enabled }, token),
  setStockPermission: (token: string, businessId: number, userId: number, enabled: boolean) =>
    request<{ employee: Employee }>(`businesses/${businessId}/employees/${userId}/permissions/`, 'PATCH', { can_post_stock: enabled }, token),
  locations: (token: string, businessId: number) =>
    request<{ locations: StockLocation[]; can_manage_locations: boolean }>(`businesses/${businessId}/locations/`, 'GET', undefined, token),
  location: (token: string, businessId: number, locationId: number) =>
    request<{ location: StockLocation; can_manage_locations: boolean }>(`businesses/${businessId}/locations/${locationId}/`, 'GET', undefined, token),
  createLocation: (token: string, businessId: number, data: LocationInput) =>
    request<{ location: StockLocation }>(`businesses/${businessId}/locations/`, 'POST', data, token),
  updateLocation: (token: string, businessId: number, locationId: number, data: Partial<LocationInput> & { is_active?: boolean }) =>
    request<{ location: StockLocation }>(`businesses/${businessId}/locations/${locationId}/`, 'PATCH', data, token),
  setDefaultLocation: (token: string, businessId: number, locationId: number) =>
    request<{ location: StockLocation }>(`businesses/${businessId}/locations/${locationId}/set-default/`, 'POST', {}, token),
};
