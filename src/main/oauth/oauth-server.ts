import http from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";
import { GoogleAccount, TokenData } from "../../shared/types";
import { AccountStore } from "../account-store/account-store";
import { getScopesForClientId, getScopeString } from "./oauth-scopes";

export interface OAuthConfig {
  clientId: string;
  clientSecret?: string;
  authEndpoint?: string;
  tokenEndpoint?: string;
  userInfoEndpoint?: string;
  scopes?: readonly string[];
}

export interface OAuthSessionOptions {
  openBrowser?: (url: string) => Promise<void> | void;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class OAuthLoopbackServer {
  private server: http.Server | null = null;
  private isRunning = false;
  private currentSessionReject: ((err: Error) => void) | null = null;
  private sessionTimeoutTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: AccountStore,
    private readonly config: OAuthConfig,
  ) {}

  public static generatePkce(): { verifier: string; challenge: string } {
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");
    return { verifier, challenge };
  }

  public static generateState(): string {
    return crypto.randomBytes(16).toString("hex");
  }

  public isInProgress(): boolean {
    return this.isRunning;
  }

  public cancel(reason = "OAuth flow cancelled by user"): void {
    if (this.currentSessionReject) {
      this.currentSessionReject(new Error(reason));
      this.currentSessionReject = null;
    }
    this.cleanup();
  }

  private cleanup(): void {
    if (this.sessionTimeoutTimer) {
      clearTimeout(this.sessionTimeoutTimer);
      this.sessionTimeoutTimer = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.isRunning = false;
  }

  public async startFlow(
    options: OAuthSessionOptions = {},
  ): Promise<GoogleAccount> {
    if (this.isRunning) {
      throw new Error("An OAuth session is already in progress");
    }

    this.isRunning = true;
    const fetchImpl = options.fetchFn || fetch;
    const timeoutMs = options.timeoutMs ?? 300_000; // 5 minutes

    const { verifier, challenge } = OAuthLoopbackServer.generatePkce();
    const state = OAuthLoopbackServer.generateState();

    return new Promise<GoogleAccount>((resolve, reject) => {
      this.currentSessionReject = reject;

      this.server = http.createServer(async (req, res) => {
        try {
          const reqUrl = new URL(req.url || "", `http://${req.headers.host}`);
          if (reqUrl.pathname !== "/callback") {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
            return;
          }

          const error = reqUrl.searchParams.get("error");
          if (error) {
            res.writeHead(400, { "Content-Type": "text/html" });
            res.end(
              "<html><body><h3>Authentication Failed</h3><p>" +
                error +
                "</p><p>You can close this tab.</p></body></html>",
            );
            this.cleanup();
            reject(new Error(`OAuth error received from provider: ${error}`));
            return;
          }

          const receivedState = reqUrl.searchParams.get("state");
          if (receivedState !== state) {
            res.writeHead(400, { "Content-Type": "text/html" });
            res.end(
              "<html><body><h3>Invalid State</h3><p>CSRF validation failed. You can close this tab.</p></body></html>",
            );
            this.cleanup();
            reject(
              new Error("State mismatch: Potential CSRF attempt detected"),
            );
            return;
          }

          const code = reqUrl.searchParams.get("code");
          if (!code) {
            res.writeHead(400, { "Content-Type": "text/html" });
            res.end(
              "<html><body><h3>Missing Authorization Code</h3><p>You can close this tab.</p></body></html>",
            );
            this.cleanup();
            reject(new Error("Missing authorization code in OAuth callback"));
            return;
          }

          // Render success to user's browser immediately
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            '<html><body style="font-family: sans-serif; background: #090d16; color: #f9fafb; text-align: center; padding: 40px;">' +
              "<h2>Authentication Complete</h2>" +
              "<p>You have successfully authenticated. You may close this tab and return to Antigravity Relay.</p>" +
              "</body></html>",
          );

          // Exchange authorization code for tokens
          const address = this.server?.address();
          const port =
            address && typeof address === "object" ? address.port : 0;
          const redirectUri = `http://127.0.0.1:${port}/callback`;

          const tokenEndpoint =
            this.config.tokenEndpoint || "https://oauth2.googleapis.com/token";

          const tokenBody: Record<string, string> = {
            client_id: this.config.clientId,
            code,
            code_verifier: verifier,
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
          };

          if (this.config.clientSecret) {
            tokenBody.client_secret = this.config.clientSecret;
          }

          const tokenRes = await fetchImpl(tokenEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams(tokenBody).toString(),
          });

          if (!tokenRes.ok) {
            const errText = await tokenRes.text();
            this.cleanup();
            reject(new Error(`Failed to exchange token: ${errText}`));
            return;
          }

          const tokenData = (await tokenRes.json()) as {
            access_token: string;
            refresh_token?: string;
            expires_in: number;
            token_type: string;
            scope?: string;
            id_token?: string;
          };

          // Fetch user profile info
          const userInfoEndpoint =
            this.config.userInfoEndpoint ||
            "https://www.googleapis.com/oauth2/v3/userinfo";

          const userRes = await fetchImpl(userInfoEndpoint, {
            headers: {
              Authorization: `Bearer ${tokenData.access_token}`,
            },
          });

          if (!userRes.ok) {
            const errText = await userRes.text();
            this.cleanup();
            reject(new Error(`Failed to fetch user profile: ${errText}`));
            return;
          }

          const userInfo = (await userRes.json()) as {
            sub: string;
            email: string;
            picture?: string;
          };

          const tokens: TokenData = {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token || "",
            expires_in: tokenData.expires_in,
            expiry_timestamp: Date.now() + tokenData.expires_in * 1000,
            token_type: tokenData.token_type || "Bearer",
            scope: tokenData.scope,
            id_token: tokenData.id_token,
          };

          const now = Date.now();
          const account: GoogleAccount = {
            id: userInfo.sub,
            email: userInfo.email,
            avatarUrl: userInfo.picture,
            status: "active",
            tokens,
            createdAt: now,
            updatedAt: now,
          };

          await this.store.saveAccount(account);
          this.cleanup();
          resolve(account);
        } catch (err) {
          this.cleanup();
          reject(err);
        }
      });

      this.sessionTimeoutTimer = setTimeout(() => {
        this.cancel("OAuth session timed out");
      }, timeoutMs);

      // Bind strictly to 127.0.0.1 with port 0 (ephemeral OS assignment)
      this.server.listen(0, "127.0.0.1", () => {
        const address = this.server?.address();
        if (!address || typeof address !== "object") {
          this.cleanup();
          reject(new Error("Failed to bind loopback server"));
          return;
        }

        const port = address.port;
        const redirectUri = `http://127.0.0.1:${port}/callback`;

        const authEndpoint =
          this.config.authEndpoint ||
          "https://accounts.google.com/o/oauth2/v2/auth";

        const authUrl = new URL(authEndpoint);
        authUrl.searchParams.set("client_id", this.config.clientId);
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set(
          "scope",
          getScopeString(
            this.config.scopes || getScopesForClientId(this.config.clientId),
          ),
        );
        authUrl.searchParams.set("state", state);
        authUrl.searchParams.set("code_challenge", challenge);
        authUrl.searchParams.set("code_challenge_method", "S256");
        authUrl.searchParams.set("access_type", "offline");
        authUrl.searchParams.set("prompt", "consent");

        if (options.openBrowser) {
          try {
            options.openBrowser(authUrl.toString());
          } catch (err) {
            this.cleanup();
            reject(err);
          }
        }
      });

      this.server.on("error", (err) => {
        this.cleanup();
        reject(err);
      });
    });
  }
}
