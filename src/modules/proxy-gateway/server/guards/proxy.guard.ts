import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { getServerConfig } from "../../../../server/server-config";
import {
  extractApiKeyToken,
  hasConfiguredApiKey,
  type RequestHeaders,
} from "./api-key-auth.util";
import {
  buildAuthErrorBody,
  resolveAuthErrorSurface,
} from "../common/auth-error-envelope";

@Injectable()
export class ProxyGuard implements CanActivate {
  private readonly logger = new Logger(ProxyGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: RequestHeaders; ip: string; url?: string }>();

    const config = getServerConfig();

    // 1. Check for API Key in config
    const apiKey = config?.api_key;

    const clientToken = extractApiKeyToken(request.headers);

    // 2. Bypass if no api_key set (Open Mode) or config missing
    if (!hasConfiguredApiKey(apiKey)) {
      return true;
    }

    if (clientToken === apiKey) {
      return true;
    }
    this.logger.warn(`Rejected unauthorized request from ${request.ip}`);

    const surface = resolveAuthErrorSurface(request);
    throw new UnauthorizedException(
      buildAuthErrorBody(surface, "API key validation failed"),
    );
  }
}
