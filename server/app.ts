import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { apiRouter } from './api';
import { renderConfigStatusHtml } from './configStatusPage';

export function createExpressApp() {
  const app = express();

  // Trust proxy (required for Vercel and Cloud Run HTTPS cookies behind reverse proxy)
  app.set('trust proxy', 1);

  // CORS headers and OPTIONS preflight handling for API routes
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token, Accept');
    }
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    next();
  });

  // Body parsers
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  // Cookie parser for HttpOnly session authentication
  app.use(cookieParser());

  // Safe server-side API logging (method, path, status, latency)
  // NEVER logs secrets, passwords, tokens, or request bodies
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    const { method, url } = req;

    res.on('finish', () => {
      if (url.startsWith('/api') || url.startsWith('/config')) {
        console.log(`[API] ${method} ${url.split('?')[0]} -> ${res.statusCode} (${Date.now() - start}ms)`);
      }
    });

    next();
  });

  // Health check endpoints
  app.get('/api/health', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/health', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Configuration status HTML page
  app.get('/config-status', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderConfigStatusHtml());
  });

  // Mount API router at both '/api' and '/'
  // Double-mounting ensures that if a reverse proxy / rewrite strips or retains '/api', routes still match identically
  app.use('/api', apiRouter);
  app.use('/', apiRouter);

  // Catch-all for unknown /api/* routes - ALWAYS return valid JSON, NEVER HTML
  app.all('/api/*', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(404).json({
      success: false,
      error: `API endpoint not found: ${req.method} ${req.path}`
    });
  });

  // Centralized Express error handler - ALWAYS return valid JSON for API routes
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error('API Error handler caught:', err?.message || 'Unknown error');
    if (res.headersSent) {
      return next(err);
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(err?.status || 500).json({
      success: false,
      error: err?.message || 'An unexpected server error occurred'
    });
  });

  return app;
}

export const app = createExpressApp();
export default app;
