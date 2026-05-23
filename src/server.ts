import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG } from './config.js';

export class WebDashboardServer {
  private server: http.Server;
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private tickCount = 0;
  private lastUpdateData: any = null;
  private onManualCloseCallback: ((modelId: string, symbol: string) => void) | null = null;
  private onToggleStatusCallback: (() => void) | null = null;


  constructor(port: number = 3000) {
    // 1. Create standard lightweight HTTP server to serve frontend assets
    this.server = http.createServer((req, res) => {
            let filePath: string;
      
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        filePath = path.join(process.cwd(), 'public', 'index.html');
      } else if (req.method === 'GET' && req.url && req.url.startsWith('/thinking-hub')) {
        filePath = path.join(process.cwd(), 'public', 'thinking-hub.html');
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      
      fs.readFile(filePath, (err, content) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error loading UI: ' + err.message);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(content);
      });
    });

    // 2. Create WebSocket server sharing the same port / HTTP server
    this.wss = new WebSocketServer({ noServer: true });

    // Handle WebSocket upgrade handshakes
    this.server.on('upgrade', (request, socket, head) => {
      const pathname = request.url ? new URL(request.url, `http://${request.headers.host}`).pathname : '';
      
      if (pathname === '/dashboard') {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    // Monitor browser client connections
    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.add(ws);
      
      // Send initial data packet immediately on connection
      if (this.lastUpdateData) {
        ws.send(JSON.stringify({
          type: 'dashboard_update',
          data: this.lastUpdateData
        }));
      }

      ws.on('message', (message: string) => {
        try {
          const parsed = JSON.parse(message.toString());
                    if (parsed.type === 'manual_close' && parsed.symbol && parsed.modelId) {
            console.log(`\x1b[35m[WEB-UI] Received manual close request for model ${parsed.modelId} symbol ${parsed.symbol}\x1b[0m`);
            if (this.onManualCloseCallback) {
              this.onManualCloseCallback(parsed.modelId, parsed.symbol);
            }
          } else if (parsed.type === 'toggle_system_status') {
            console.log(`\x1b[35m[WEB-UI] Received system ON/OFF status toggle request\x1b[0m`);
            if (this.onToggleStatusCallback) {
              this.onToggleStatusCallback();
            }
          } else if (parsed.type === 'request_thinking_detail' && parsed.symbol) {
            // Send detailed thinking data for the requested symbol from lastUpdateData
            if (this.lastUpdateData) {
              const models = this.lastUpdateData.models || {};
              const details: Record<string, any> = {};
              for (const [modelId, modelData] of Object.entries(models)) {
                const aiInsights = (modelData as any).aiInsights || {};
                if (aiInsights[parsed.symbol]) {
                  const insight = aiInsights[parsed.symbol];
                  const activePos = ((modelData as any).activePositions || []).find((p: any) => p.symbol === parsed.symbol);
                  details[modelId] = {
                    insight,
                    position: activePos || null,
                    stats: (modelData as any).stats || null
                  };
                }
              }
              ws.send(JSON.stringify({
                type: 'thinking_detail',
                symbol: parsed.symbol,
                details
              }));
            }
          }
        } catch (err: any) {
          console.error('[WEB-UI] Error parsing WebSocket message:', err.message);
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', (err) => {
        console.error('[WEB-UI] WebSocket Client Error:', err.message);
        this.clients.delete(ws);
      });
    });

    // 3. Start the Server
    this.server.listen(port, () => {
      console.log(`\n\x1b[32m\x1b[1m[WEB-UI] Premium Real-time HTML Dashboard is now online!`);
      console.log(`[WEB-UI] Open this link in your browser to view it live:`);
      console.log(`\x1b[36m\x1b[4mhttp://localhost:${port}/\x1b[0m\n`);
    });
  }

  /**
   * Broadcasts a sub-millisecond price heartbeat tick to flash the browser LED
   */
  public broadcastTick() {
    this.tickCount++;
    const payload = JSON.stringify({
      type: 'heartbeat',
      tickCount: this.tickCount
    });

    this.broadcast(payload);
  }

  /**
   * Broadcasts a full dashboard data packet (stats, active positions, trades history) to the UI
   */
  public broadcastUpdate(engineData: any) {
    this.lastUpdateData = {
      simMode: CONFIG.SIMULATION_MODE,
      models: engineData.models,
      isTradingActive: engineData.isTradingActive
    };

    const payload = JSON.stringify({
      type: 'dashboard_update',
      data: this.lastUpdateData
    });

    this.broadcast(payload);
  }

  /**
   * Internal helper to send payload to all active web clients
   */
  private broadcast(payload: string) {
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  /**
   * Registers a callback to execute when a browser manual close position request is received
   */
  public registerManualCloseCallback(callback: (modelId: string, symbol: string) => void) {
    this.onManualCloseCallback = callback;
  }

  public registerToggleStatusCallback(callback: () => void) {
    this.onToggleStatusCallback = callback;
  }

  /**
   * Shutdown Server gracefully
   */
  public close() {
    this.wss.close();
    this.server.close();
  }
}
