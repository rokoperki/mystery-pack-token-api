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
import { PrepareCampaignDto, RecordPurchaseDto, Tier } from './campaigns.types';

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

  async recordPurchase(id: string, dto: RecordPurchaseDto) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    if (campaign.status !== 'ACTIVE') {
      throw new BadRequestException('Campaign not active');
    }

    const campaignPda = new PublicKey(
      campaign.publicKey ??
        (() => {
          throw new BadRequestException('Campaign public key is null');
        })(),
    );

    const buyerPubkey = new PublicKey(dto.buyer);
    const nonce = BigInt(dto.nonce);

    // Verify receipt exists on-chain
    const receipt = await this.solana.getReceipt(
      this.programId,
      campaignPda,
      buyerPubkey,
      nonce,
    );

    if (!receipt) {
      throw new BadRequestException('Receipt not found on-chain');
    }

    if (receipt.packIndex !== dto.packIndex) {
      throw new BadRequestException('Pack index mismatch');
    }

    // Store in DB
    const purchase = await this.prisma.purchase.create({
      data: {
        campaignId: id,
        buyer: dto.buyer,
        nonce,
        packIndex: dto.packIndex,
        signature: dto.signature,
      },
    });

    return { success: true, purchaseId: purchase.id };
  }

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

    // Look up purchase from DB to get nonce
    const purchase = await this.prisma.purchase.findFirst({
      where: { campaignId: id, buyer: walletAddress, packIndex },
    });

    if (!purchase) {
      throw new BadRequestException('Pack not purchased');
    }

    const campaignPda = new PublicKey(
      campaign.publicKey ??
        (() => {
          throw new BadRequestException('Campaign public key is null');
        })(),
    );

    // Verify ownership on-chain using buyer + nonce
    const receipt = await this.solana.getReceipt(
      this.programId,
      campaignPda,
      new PublicKey(walletAddress),
      purchase.nonce,
    );

    if (!receipt) {
      throw new BadRequestException('Receipt not found on-chain');
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
      tier: pack.tier,
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

  async getHistory(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        packs: { orderBy: { index: 'asc' } },
        purchases: true,
      },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    const campaignPda = new PublicKey(
      campaign.publicKey ??
        (() => {
          throw new BadRequestException('Campaign public key is null');
        })(),
    );

    // Build a map of packIndex -> purchase for quick lookup
    const purchaseByPackIndex = new Map(
      campaign.purchases.map((p) => [p.packIndex, p]),
    );

    const packHistory = await Promise.all(
      campaign.packs.map(async (pack) => {
        const purchase = purchaseByPackIndex.get(pack.index);
        if (!purchase) {
          return {
            index: pack.index,
            tier: pack.tier,
            tokenAmount: null,
            buyer: null,
            isClaimed: false,
            isPurchased: false,
          };
        }

        // Verify claim status on-chain
        const receipt = await this.solana.getReceipt(
          this.programId,
          campaignPda,
          new PublicKey(purchase.buyer),
          purchase.nonce,
        );

        return {
          index: pack.index,
          tier: pack.tier,
          tokenAmount: receipt?.isClaimed ? pack.tokenAmount.toString() : null,
          buyer: purchase.buyer,
          isClaimed: receipt?.isClaimed || false,
          isPurchased: true,
        };
      }),
    );

    return {
      campaignId: campaign.id,
      totalPacks: campaign.totalPacks,
      packs: packHistory,
    };
  }

  async getAnalytics(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        packs: true,
        purchases: true,
      },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    const campaignPda = new PublicKey(
      campaign.publicKey ??
        (() => {
          throw new BadRequestException('Campaign public key is null');
        })(),
    );

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

    // Build packIndex -> pack lookup
    const packByIndex = new Map(campaign.packs.map((p) => [p.index, p]));

    let packsClaimed = 0;
    const packsSold = campaign.purchases.length;

    // Check claim status for each purchase
    for (const purchase of campaign.purchases) {
      const receipt = await this.solana.getReceipt(
        this.programId,
        campaignPda,
        new PublicKey(purchase.buyer),
        purchase.nonce,
      );

      if (receipt?.isClaimed) {
        packsClaimed++;
        const pack = packByIndex.get(purchase.packIndex);
        if (pack) {
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
