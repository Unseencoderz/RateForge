import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  requestId?: string;
  traceId?: string;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function bindRequestContext(context: RequestContext, callback: () => void): void {
  requestContextStorage.run(context, callback);
}

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}
