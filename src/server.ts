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

  constructor(port: number = 3000) {
    // 1. Create standard lightweight HTTP server to serve frontend assets
    this.server = http.createServer((req, res) => {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        const filePath = path.join(process.cwd(), 'public', 'index.html');
        
        fs.readFile(filePath, (err, content) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error loading dashboard UI: ' + err.message);
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(content);
        });
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
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
      stats: engineData.stats,
      activePositions: engineData.activePositions,
      tradesHistory: engineData.tradesHistory
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
   * Shutdown Server gracefully
   */
  public close() {
    this.wss.close();
    this.server.close();
  }
}
