import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { MerkleModule } from '../merkle/merkle.module';
import { SolanaModule } from '../solana/solana.module';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  imports: [MerkleModule, SolanaModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, PrismaService],
})
export class CampaignsModule {}
