import { authContext } from 'void/auth';

// Void already resolved this request's session and will forward its refreshed cookies. Keep the
// sharing service provider-neutral while avoiding repeated Better Auth/database lookups within it.
export const getRequestAuth = (auth: unknown) => {
  const store = authContext.getStore();
  return store && auth ? { api: { getSession: async () => store.state } } : auth;
};
