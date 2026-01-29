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
    const seed = BigInt(Date.now());

    const packs = this.generatePacks(dto.totalPacks, dto.tiers);

    const packData = packs.map((p, i) => ({
      index: i,
      tokenAmount: BigInt(p.tokenAmount),
      salt: p.salt,
    }));
    const { root } = this.merkle.buildTree(packData);

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
