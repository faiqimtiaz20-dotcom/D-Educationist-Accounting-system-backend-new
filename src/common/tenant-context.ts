import { AsyncLocalStorage } from 'async_hooks';

type TenantStore = {
  tenantId: string | null;
  isPlatform: boolean;
};

const storage = new AsyncLocalStorage<TenantStore>();

export const TenantContext = {
  /** Bind tenant for the rest of this async request (Nest interceptor-safe). */
  enter(store: TenantStore) {
    storage.enterWith(store);
  },

  run<T>(store: TenantStore, fn: () => T): T {
    return storage.run(store, fn);
  },

  getTenantId(): string | null {
    return storage.getStore()?.tenantId ?? null;
  },

  isPlatform(): boolean {
    return storage.getStore()?.isPlatform === true;
  },

  hasTenant(): boolean {
    return Boolean(storage.getStore()?.tenantId);
  },
};
