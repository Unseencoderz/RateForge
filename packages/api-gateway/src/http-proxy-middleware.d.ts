declare module 'http-proxy-middleware' {
  import type { Request, RequestHandler, Response } from 'express';

  export interface ProxyMiddlewareOptions {
    target: string;
    changeOrigin?: boolean;
    xfwd?: boolean;
    on?: {
      proxyReq?: (proxyReq: unknown, req: Request, res: Response) => void;
    };
  }

  export function createProxyMiddleware(options: ProxyMiddlewareOptions): RequestHandler;
  export function fixRequestBody(proxyReq: unknown, req: Request, res: Response): void;
}
