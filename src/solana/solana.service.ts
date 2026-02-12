// src/solana/solana.service.ts
import { Injectable } from '@nestjs/common';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

@Injectable()
export class SolanaService {
  private connection: Connection;
  private feeRecipientKeypair: Keypair;

  constructor() {
    this.connection = new Connection(
      process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
    );
    this.feeRecipientKeypair = Keypair.fromSecretKey(
      new Uint8Array(
        JSON.parse(
          process.env.FEE_RECIPIENT_PRIVATE_KEY ??
            (() => {
              throw new Error('FEE_RECIPIENT_PRIVATE_KEY is not defined');
            })(),
        ),
      ),
    );
  }

  get feeRecipientPublicKey(): PublicKey {
    return this.feeRecipientKeypair.publicKey;
  }

  async verifyTransaction(signature: string): Promise<boolean> {
    try {
      const tx = await this.connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      return tx !== null && tx.meta?.err === null;
    } catch {
      return false;
    }
  }

  async getReceipt(
    programId: PublicKey,
    campaignPda: PublicKey,
    buyer: PublicKey,
    nonce: bigint,
  ): Promise<{
    buyer: PublicKey;
    packIndex: number;
    isClaimed: boolean;
    nonce: bigint;
  } | null> {
    const [receiptPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('receipt'),
        campaignPda.toBuffer(),
        buyer.toBuffer(),
        this.bigintToLeBytes(nonce),
      ],
      programId,
    );

    try {
      const accountInfo = await this.connection.getAccountInfo(receiptPda, {
        commitment: 'confirmed',
      });
      if (!accountInfo) return null;

      const data = accountInfo.data;
      // Receipt layout (1-byte discriminator):
      // [0]: discriminator, [1..33]: campaign, [33..65]: buyer,
      // [65..69]: pack_index (u32 LE), [69]: is_claimed, [70..78]: nonce (u64 LE)
      const receiptBuyer = new PublicKey(data.slice(33, 65));
      const packIndex = data.readUInt32LE(65);
      const isClaimed = data[69] === 1;
      const receiptNonce = data.readBigUInt64LE(70);

      return { buyer: receiptBuyer, packIndex, isClaimed, nonce: receiptNonce };
    } catch {
      return null;
    }
  }

  async buildInitializeCampaignTx(
    programId: PublicKey,
    authority: PublicKey,
    tokenMint: PublicKey,
    seed: bigint,
    merkleRoot: Buffer,
    packPrice: bigint,
    totalPacks: number,
  ): Promise<string> {
    const campaignPda = this.getCampaignPda(programId, seed);

    const [solVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), campaignPda.toBuffer()],
      programId,
    );

    const data = Buffer.alloc(53);
    data.writeUInt8(0, 0);
    data.writeBigUInt64LE(seed, 1);
    merkleRoot.copy(data, 9);
    data.writeBigUInt64LE(packPrice, 41);
    data.writeUInt32LE(totalPacks, 49);

    const ix = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: authority, isSigner: true, isWritable: true },
        {
          pubkey: this.feeRecipientKeypair.publicKey,
          isSigner: true,
          isWritable: true,
        },
        { pubkey: campaignPda, isSigner: false, isWritable: true },
        { pubkey: tokenMint, isSigner: false, isWritable: false },
        { pubkey: solVaultPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = authority;
    tx.recentBlockhash = (
      await this.connection.getLatestBlockhash('confirmed')
    ).blockhash;

    tx.partialSign(this.feeRecipientKeypair);

    return tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString('base64');
  }

  getCampaignPda(programId: PublicKey, seed: bigint): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('campaign'), this.bigintToLeBytes(seed)],
      programId,
    );
    return pda;
  }

  private bigintToLeBytes(value: bigint): Buffer {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(value);
    return buffer;
  }
}
