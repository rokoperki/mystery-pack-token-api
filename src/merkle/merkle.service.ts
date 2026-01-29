import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

interface PackData {
  index: number;
  tokenAmount: bigint;
  salt: Buffer;
}

@Injectable()
export class MerkleService {
  private sha256(data: Buffer): Buffer {
    return createHash('sha256').update(data).digest();
  }

  private hashPair(left: Buffer, right: Buffer): Buffer {
    return this.sha256(Buffer.concat([left, right]));
  }

  createLeaf(packIndex: number, tokenAmount: bigint, salt: Buffer): Buffer {
    const data = Buffer.alloc(44);
    data.writeUInt32LE(packIndex, 0);
    data.writeBigUInt64LE(tokenAmount, 4);
    salt.copy(data, 12);
    return this.sha256(data);
  }

  buildTree(packs: PackData[]): { root: Buffer; tree: Buffer[][] } {
    let level = packs.map((p) =>
      this.createLeaf(p.index, p.tokenAmount, p.salt),
    );

    const nextPow2 = Math.pow(2, Math.ceil(Math.log2(level.length)));
    while (level.length < nextPow2) {
      level.push(Buffer.alloc(32, 0));
    }

    const tree: Buffer[][] = [level];

    while (level.length > 1) {
      const nextLevel: Buffer[] = [];
      for (let i = 0; i < level.length; i += 2) {
        nextLevel.push(this.hashPair(level[i], level[i + 1]));
      }
      tree.push(nextLevel);
      level = nextLevel;
    }

    return { root: level[0], tree };
  }

  getProof(tree: Buffer[][], index: number): Buffer[] {
    const proof: Buffer[] = [];
    let idx = index;

    for (let i = 0; i < tree.length - 1; i++) {
      const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
      proof.push(tree[i][siblingIdx]);
      idx = Math.floor(idx / 2);
    }

    return proof;
  }
}
