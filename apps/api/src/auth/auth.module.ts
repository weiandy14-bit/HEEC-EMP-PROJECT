import { Global, Module } from '@nestjs/common';
import { OidcService } from './oidc.service';
import { IdentityService } from './identity.service';
import { AuthGuard } from './request-context';
import { RolesGuard } from './roles.guard';

/**
 * 全域身分模組：提供 OIDC 驗證與 DB 身分對應給所有以 @UseGuards(AuthGuard, RolesGuard)
 * 保護的控制器。DatabaseModule 為 @Global，IdentityService 可直接注入。
 */
@Global()
@Module({
  providers: [OidcService, IdentityService, AuthGuard, RolesGuard],
  exports: [OidcService, IdentityService, AuthGuard, RolesGuard],
})
export class AuthModule {}
