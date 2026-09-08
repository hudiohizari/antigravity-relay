import { Module } from '@nestjs/common';
import { ProxyModule } from '../modules/proxy-gateway/server/proxy.module';

@Module({
  imports: [ProxyModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
