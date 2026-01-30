import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MerkleService } from '../merkle/merkle.service';
import { SolanaService } from '../solana/solana.service';
import { randomBytes } from 'crypto';
import { PublicKey } from '@solana/web3.js';
import { PrepareCampaignDto, Tier } from './campaigns.types';

@Injectable()
export class CampaignsService {
  private readonly programId = new PublicKey(
    process.env.PROGRAM_ID ??
      (() => {
        throw new Error('PROGRAM_ID is not defined');
      })(),
  );

  constructor(
    private prisma: PrismaService,
    private merkle: MerkleService,
    private solana: SolanaService,
  ) {}

  async prepare(dto: PrepareCampaignDto) {
    const seed = BigInt(dto.seed);

    const packs = this.generatePacks(dto.totalPacks, dto.tiers);

    // Build merkle tree
    const packData = packs.map((p, i) => ({
      index: i,
      tokenAmount: BigInt(p.tokenAmount),
      salt: p.salt,
    }));
    const { root } = this.merkle.buildTree(packData);

    // Store campaign
    const campaign = await this.prisma.campaign.create({
      data: {
        seed,
        authority: dto.authority,
        tokenMint: dto.tokenMint,
        packPrice: BigInt(dto.packPrice),
        totalPacks: dto.totalPacks,
        merkleRoot: root.toString('hex'),
        packs: {
          create: packs.map((p, i) => ({
            index: i,
            tokenAmount: BigInt(p.tokenAmount),
            salt: p.salt.toString('hex'),
            tier: p.tier,
          })),
        },
      },
    });

    return {
      id: campaign.id,
      seed: seed.toString(),
      merkleRoot: Array.from(root),
    };
  }
  async confirm(id: string, signature: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    if (campaign.status !== 'PENDING') {
      throw new BadRequestException('Campaign already confirmed');
    }

    const isValid = await this.solana.verifyTransaction(signature);
    if (!isValid) {
      throw new BadRequestException('Invalid transaction');
    }

    const publicKey = this.solana.getCampaignPda(this.programId, campaign.seed);

    await this.prisma.campaign.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        publicKey: publicKey.toBase58(),
        confirmedAt: new Date(),
      },
    });

    return { success: true, publicKey: publicKey.toBase58() };
  }

  async findOne(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not aa');
    }

    return {
      id: campaign.id,
      seed: campaign.seed.toString(),
      authority: campaign.authority,
      tokenMint: campaign.tokenMint,
      packPrice: campaign.packPrice.toString(),
      totalPacks: campaign.totalPacks,
      merkleRoot: campaign.merkleRoot,
      status: campaign.status,
      publicKey: campaign.publicKey,
    };
  }

  async findAll() {
    const campaigns = await this.prisma.campaign.findMany();

    return campaigns.map((campaign) => ({
      id: campaign.id,
      seed: campaign.seed.toString(),
      authority: campaign.authority,
      tokenMint: campaign.tokenMint,
      packPrice: campaign.packPrice.toString(),
      totalPacks: campaign.totalPacks,
      merkleRoot: campaign.merkleRoot,
      status: campaign.status,
      publicKey: campaign.publicKey,
    }));
  }

  // campaigns.service.ts - update getReveal method
  async getReveal(id: string, packIndex: number, walletAddress: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: { packs: { where: { index: packIndex } } },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    if (campaign.status !== 'ACTIVE') {
      throw new BadRequestException('Campaign not active');
    }

    const pack = campaign.packs[0];
    if (!pack) {
      throw new NotFoundException('Pack not found');
    }

    // Verify ownership on-chain
    const receipt = await this.solana.getReceipt(
      this.programId,
      new PublicKey(
        campaign.publicKey ??
          (() => {
            throw new BadRequestException('Campaign public key is null');
          })(),
      ),
      packIndex,
    );

    if (!receipt) {
      throw new BadRequestException('Pack not purchased');
    }

    if (receipt.buyer.toBase58() !== walletAddress) {
      throw new BadRequestException('Not pack owner');
    }

    if (receipt.isClaimed) {
      throw new BadRequestException('Already claimed');
    }

    // Rebuild tree and get proof
    const packs = await this.prisma.pack.findMany({
      where: { campaignId: id },
      orderBy: { index: 'asc' },
    });

    const packData = packs.map((p) => ({
      index: p.index,
      tokenAmount: p.tokenAmount,
      salt: Buffer.from(p.salt, 'hex'),
    }));

    const { tree } = this.merkle.buildTree(packData);
    const proof = this.merkle.getProof(tree, packIndex);

    return {
      tokenAmount: pack.tokenAmount.toString(),
      salt: Array.from(Buffer.from(pack.salt, 'hex')),
      proof: proof.map((p) => Array.from(p)),
      tier: pack.tier, // Include tier
    };
  }

  // campaigns.service.ts - add method
  async closeCampaign(id: string, signature: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    if (campaign.status === 'CLOSED') {
      throw new BadRequestException('Campaign already closed');
    }

    // Verify transaction
    const isValid = await this.solana.verifyTransaction(signature);
    if (!isValid) {
      throw new BadRequestException('Invalid transaction');
    }

    // Update status in DB
    await this.prisma.campaign.update({
      where: { id },
      data: {
        status: 'CLOSED',
      },
    });

    return { success: true };
  }

  // campaigns.service.ts
  async getHistory(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        packs: {
          orderBy: { index: 'asc' },
        },
      },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    // Fetch on-chain data for each pack
    const campaignPda = new PublicKey(
      campaign.publicKey ??
        (() => {
          throw new BadRequestException('Campaign public key is null');
        })(),
    );
    const packHistory = await Promise.all(
      campaign.packs.map(async (pack) => {
        const receipt = await this.solana.getReceipt(
          this.programId,
          campaignPda,
          pack.index,
        );

        return {
          index: pack.index,
          tier: pack.tier,
          // Only show amount if claimed (for transparency)
          tokenAmount: receipt?.isClaimed ? pack.tokenAmount.toString() : null,
          buyer: receipt?.buyer?.toBase58() || null,
          isClaimed: receipt?.isClaimed || false,
          isPurchased: !!receipt,
        };
      }),
    );

    return {
      campaignId: campaign.id,
      totalPacks: campaign.totalPacks,
      packs: packHistory,
    };
  }

  // campaigns.service.ts
  async getAnalytics(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        packs: true,
      },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    // Fetch on-chain data
    const campaignPda = new PublicKey(
      campaign.publicKey ??
        (() => {
          throw new BadRequestException('Campaign public key is null');
        })(),
    );

    let packsSold = 0;
    let packsClaimed = 0;
    const tierDistribution: Record<
      string,
      { total: number; claimed: number; tokens: bigint }
    > = {};

    // Initialize tier distribution
    campaign.packs.forEach((pack) => {
      if (!tierDistribution[pack.tier]) {
        tierDistribution[pack.tier] = {
          total: 0,
          claimed: 0,
          tokens: BigInt(0),
        };
      }
      tierDistribution[pack.tier].total++;
    });

    // Check each pack on-chain
    for (const pack of campaign.packs) {
      const receipt = await this.solana.getReceipt(
        this.programId,
        campaignPda,
        pack.index,
      );

      if (receipt) {
        packsSold++;
        if (receipt.isClaimed) {
          packsClaimed++;
          tierDistribution[pack.tier].claimed++;
          tierDistribution[pack.tier].tokens += pack.tokenAmount;
        }
      }
    }

    const solCollected = BigInt(packsSold) * campaign.packPrice;

    return {
      campaignId: campaign.id,
      overview: {
        totalPacks: campaign.totalPacks,
        packsSold,
        packsClaimed,
        packsRemaining: campaign.totalPacks - packsSold,
        solCollected: solCollected.toString(),
        claimRate:
          packsSold > 0 ? ((packsClaimed / packsSold) * 100).toFixed(1) : '0',
      },
      tierBreakdown: Object.entries(tierDistribution).map(([tier, data]) => ({
        tier,
        totalPacks: data.total,
        claimedPacks: data.claimed,
        tokensDistributed: data.tokens.toString(),
      })),
    };
  }

  private generatePacks(
    total: number,
    tiers: Tier[],
  ): { tokenAmount: number; salt: Buffer; tier: string }[] {
    const packs: { tokenAmount: number; salt: Buffer; tier: string }[] = [];

    const sortedTiers = [...tiers].sort((a, b) => a.chance - b.chance);

    for (let i = 0; i < total; i++) {
      const roll = Math.random();
      let cumulative = 0;
      let selectedTier = sortedTiers[sortedTiers.length - 1];

      for (const tier of sortedTiers) {
        cumulative += tier.chance;
        if (roll < cumulative) {
          selectedTier = tier;
          break;
        }
      }

      const tokenAmount = this.randomInRange(
        selectedTier.min,
        selectedTier.max,
      );

      packs.push({
        tokenAmount,
        salt: randomBytes(32),
        tier: selectedTier.name,
      });
    }

    return packs;
  }

  private randomInRange(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
