import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { MerkleModule } from './merkle/merkle.module';
import { SolanaModule } from './solana/solana.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot(),
    PrismaModule,
    CampaignsModule,
    MerkleModule,
    SolanaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
