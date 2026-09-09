import https from "node:https";
import http, { IncomingMessage, ServerResponse } from "node:http";
import WebSocket, { WebSocketServer } from "ws";

export const TEST_TLS_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDYQM3ls6mpFV0l
hDI9bVO3vCCQ79BIOJJ0/Z5PBOWEDjpV4Rj3sz+td6/tl1+wPTUEWzDhUgYcrNbY
d06MOrJXlQtpHOanDHH4cvC87yHx/X3yU9KhorUu5Nu1ZCTkbByUCID9H22VgUFS
w2Kcdtd064JrKZ0n2wXI3Tvy4V2bvvtNTekKJeHn+jp58m1y3hZU/YSDoPzO6SNJ
xNgX3Wds9mU+Rk5sarNwNh0HgEkwI+86S4kzKTgWwT9w8G++yclXh4rY+33cax2C
0qjvpwHmHd+PJ7BMzd9PhFcpkUeyM4YxabS5ZTJvJjI7QgB7zumE1hOowoDBAbUu
Rtk51jYdAgMBAAECggEAB0knprWG4ct2d+0cRDWKvIX6EugBfG1rgcWJr9/aW7ie
/oW28aF4Y7/EjZyr/KQTRTJNU0oQKqcoFeLvIopXt9utprzyiG5C6Lv2oGbuHdkM
hT2NuyRgNlQ/krztAUUjMVmX/u8wIflY2hD7IYpfd/D3U+TzBoS6jSnm+yfcn4Kf
2YviFIfwiYBRc39WFIlmK7xHmH+I0OBXdZWhHFgOUf7F5k9BwjvAy8Sbyljeu7Oq
EKn1Q3k9o9/WUs4Abtin8n0gB9Askl3FyLhhnV2HqVw6PhESwewwDEgvMYi0TnvD
K+aDFMU/ze698fDKuXzVWACFtfNzN24TbJRBh7PtgQKBgQDvSo5KC2WctEmcCypv
AOY74UIyoU0Uxv8ssrgpld9dGpoGrocWxU3+bC4yzPphYfodhb6wR5N7sP3AvALG
YlERfJynJaUdadjx6y7Z1m7XV6UcNjWsNBN5t2gV1tDML8YTMOA5UzcvJRFj3G7C
4RTmHgsgXrnow5cAyAJRob45cwKBgQDnWm6BRBUEG3mNS3GM1jPUSqLRVIP8Y5sV
cG45aNBIOpT2FpHCnEUq3k2IB+VRA663O4EHmEexmf+HrQGxJZ7jFbEXEewhFJ41
+FD8zx2cxaxJkv7n7FQjr0WXYognMqbDvKG3TvP5pSX60CGKU1uKQt3EKW9qNOtN
Ipg6Jk0uLwKBgQDQreMyvYeqxisfczlZPp6J/+LcBoETKoukLmOemH4HUsiaJR/Y
As8Gns8XLFz6Chi2IEnwryr2Bp70ssF0wo7SQirXNWQuJ32zU5czD+bv0xZBaSEb
gPqu/fw+d2z1dIA3gjs4otKQQbJNtRG+z82K9Q5c918Hl3KbktE64WPj8wKBgQCO
Kxs3InBLutqCQnc/1a256jeNrYMCCO+XSCTj8I31pNI/O3VNAxzaEAvS6Q85Lqsh
/FX5JdIAyKKnbGBazMSLxZuykpfpaDMk9ThHcrs+yJZsDAHK4YZ++0knkywZ8l1a
cUNrUwBIS/0/2MCTsU/Sce63icLmoChsmTK0oS7SjwKBgQCAzV5a2wtCCKJEYYcC
vLVQ8TQYd7XpX0zjUBaQoY/0R15wSBN11KOGw68FAOohMps97xDs/GkCNAH2foGt
5LNBOxEhdkQq+sqNlLmmLShVDK9KihHYs86RFk73Hr3IBQwjVu4c6mM2zXJMDKmY
aF6rd+dmQgNQtBrAIzMHuW5O7Q==
-----END PRIVATE KEY-----`;

export const TEST_TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIDCTCCAfGgAwIBAgIUbQM1pqh6Zd7986yCd4abh5rB4VswDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MDkwODE4MzUzMloXDTM2MDkw
NTE4MzUzMlowFDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEA2EDN5bOpqRVdJYQyPW1Tt7wgkO/QSDiSdP2eTwTlhA46
VeEY97M/rXev7ZdfsD01BFsw4VIGHKzW2HdOjDqyV5ULaRzmpwxx+HLwvO8h8f19
8lPSoaK1LuTbtWQk5GwclAiA/R9tlYFBUsNinHbXdOuCaymdJ9sFyN078uFdm777
TU3pCiXh5/o6efJtct4WVP2Eg6D8zukjScTYF91nbPZlPkZObGqzcDYdB4BJMCPv
OkuJMyk4FsE/cPBvvsnJV4eK2Pt93GsdgtKo76cB5h3fjyewTM3fT4RXKZFHsjOG
MWm0uWUybyYyO0IAe87phNYTqMKAwQG1LkbZOdY2HQIDAQABo1MwUTAdBgNVHQ4E
FgQUawXMEJDFs9z87givekJl0MfF9xYwHwYDVR0jBBgwFoAUawXMEJDFs9z87giv
ekJl0MfF9xYwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAp4QG
++NYP38lWF332rJdL8f+DwPlC8UKl8HxwfkGBikTQ3fyR39NwVELEqO+iaOxa26W
qjpZQ3wH8+VGDr2fFuYGn1f0T3v5b5fS/1B01fJiy7+U+yUhS2onnpKnWatnqORl
IMrBscELVGlfyUj+N1inHoIoYLMjQIOyF8F9QLBOnIkBWdnAzB77vSTlt14KhLmO
O+pYz9K9uvi0mIVrPil1tTxSTf7/k/kfcSawB1sAYegrRH9QXF7mBVh+FNR/4lah
l00B1BnBgjHf3eJB3LPX+E56Z+wbA+5AteVKP0pqJWZ5Lzxi+lN9XIFOuASZqfHM
bCvlnl7yb+WyzKsT8Q==
-----END CERTIFICATE-----`;

export interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface MockUpstreamOptions {
  csrfToken?: string;
  validateCsrf?: boolean;
}

export class MockUpstreamServer {
  private server: https.Server | null = null;
  private wss: WebSocketServer | null = null;
  private port: number = 0;
  private csrfToken: string;
  private validateCsrf: boolean;

  public recordedRequests: RecordedRequest[] = [];
  public connectedSockets: Set<WebSocket> = new Set();
  public recordedWsHeaders: http.IncomingHttpHeaders[] = [];
  public recordedWsMessages: string[] = [];

  constructor(options?: MockUpstreamOptions) {
    this.csrfToken = options?.csrfToken ?? "mock-csrf-token-default";
    this.validateCsrf = options?.validateCsrf ?? true;
  }

  public getPort(): number {
    return this.port;
  }

  public getCsrfToken(): string {
    return this.csrfToken;
  }

  public setCsrfToken(token: string): void {
    this.csrfToken = token;
  }

  public async start(requestedPort: number = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = https.createServer(
        {
          key: TEST_TLS_KEY,
          cert: TEST_TLS_CERT,
        },
        (req: IncomingMessage, res: ServerResponse) => {
          this.handleHttpRequest(req, res);
        },
      );

      this.wss = new WebSocketServer({ noServer: true });

      this.server.on("upgrade", (req, socket, head) => {
        const url = req.url ? new URL(req.url, "http://127.0.0.1") : null;
        if (url?.pathname === "/connect-websocket") {
          this.recordedWsHeaders.push(req.headers);

          if (this.validateCsrf) {
            const clientCsrf = req.headers["x-codeium-csrf-token"];
            if (clientCsrf !== this.csrfToken) {
              socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
              socket.destroy();
              return;
            }
          }

          this.wss?.handleUpgrade(req, socket, head, (ws) => {
            this.connectedSockets.add(ws);
            ws.on("message", (msg) => {
              this.recordedWsMessages.push(msg.toString());
              // Echo message back
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(msg);
              }
            });
            ws.on("close", () => {
              this.connectedSockets.delete(ws);
            });
          });
          return;
        }

        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
      });

      this.server.listen(requestedPort, "127.0.0.1", () => {
        const addr = this.server?.address();
        if (addr && typeof addr === "object") {
          this.port = addr.port;
          resolve(this.port);
        } else {
          reject(new Error("Failed to obtain server port"));
        }
      });

      this.server.on("error", reject);
    });
  }

  public async stop(): Promise<void> {
    for (const ws of this.connectedSockets) {
      try {
        ws.close(1000, "Upstream stopping");
      } catch {
        // Suppress close error
      }
    }
    this.connectedSockets.clear();

    if (this.wss) {
      try {
        this.wss.close();
      } catch {
        // Suppress wss close error
      }
      this.wss = null;
    }

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => resolve());
      });
      this.server = null;
    }
  }

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const bodyStr = Buffer.concat(chunks).toString("utf-8");
      this.recordedRequests.push({
        method: req.method || "GET",
        url: req.url || "/",
        headers: req.headers,
        body: bodyStr,
      });

      const url = req.url || "/";

      if (url === "/" || url.startsWith("/?")) {
        const html = `<!doctype html><html><head><script>window.__APP_CONFIG__ = {csrfToken: "${this.csrfToken}"};</script></head><body><h1>Antigravity App</h1></body></html>`;
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
          "X-Custom-Header": "antigravity-upstream",
        });
        res.end(html);
        return;
      }

      if (url === "/main.js") {
        res.writeHead(200, {
          "Content-Type": "application/javascript; charset=UTF-8",
        });
        res.end('console.log("main.js bundle loaded");');
        return;
      }

      if (url === "/compiled_tailwind.css") {
        res.writeHead(200, { "Content-Type": "text/css; charset=UTF-8" });
        res.end("body { margin: 0; }");
        return;
      }

      if (url === "/jetbox.css") {
        res.writeHead(200, { "Content-Type": "text/css; charset=UTF-8" });
        res.end(".jetbox { display: flex; }");
        return;
      }

      if (url === "/prism_bundle.js") {
        res.writeHead(200, {
          "Content-Type": "application/javascript; charset=UTF-8",
        });
        res.end("window.Prism = { highlight: () => {} };");
        return;
      }

      if (url === "/api/error-429") {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "rate_limit_exceeded" }));
        return;
      }

      if (url === "/api/error-500") {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "internal_server_error" }));
        return;
      }

      if (url.startsWith("/api/")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            method: req.method,
            path: url,
            receivedBody: bodyStr ? JSON.parse(bodyStr) : null,
          }),
        );
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    });
  }
}
