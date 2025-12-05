import type { HardhatViemHelpers } from "@nomicfoundation/hardhat-viem/types";
import type { ChainType } from "hardhat/types/network";
import type { Address, Hash } from "viem";

import assert from "node:assert/strict";

import { isHash } from "@nomicfoundation/hardhat-utils/eth";

export type BalanceChangeChecker = (change: bigint) => boolean;

export async function balancesHaveChanged<
  ChainTypeT extends ChainType | string = "generic",
>(
  viem: HardhatViemHelpers<ChainTypeT>,
  txHash: Hash | Promise<Hash>,
  changes: Array<{
    address: Address;
    amount: bigint | BalanceChangeChecker;
  }>,
): Promise<void> {
  const resolvedTxHash = await txHash;

  assert.ok(
    isHash(resolvedTxHash),
    `txHash must be a transaction hash or a promise resolving to one, but got: ${String(resolvedTxHash)}`,
  );

  const publicClient = await viem.getPublicClient();

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: resolvedTxHash,
  });

  const senderAddress = receipt.from;
  const blockNrAfterTx = receipt.blockNumber;

  const beforeBalances = await Promise.all(
    changes.map(({ address }) =>
      publicClient.getBalance({
        address,
        blockNumber: blockNrAfterTx - 1n,
      }),
    ),
  );

  const afterBalances = await Promise.all(
    changes.map(async ({ address }) => {
      let balance = await publicClient.getBalance({
        address,
        blockNumber: blockNrAfterTx,
      });

      if (address === senderAddress) {
        const senderGasFee = receipt.effectiveGasPrice * receipt.gasUsed;
        balance = balance + senderGasFee;
      }

      return balance;
    }),
  );

  changes.forEach(({ address, amount: amountOrChecker }, index) => {
    const balanceBefore = beforeBalances[index];
    const balanceAfter = afterBalances[index];

    const actualChange = balanceAfter - balanceBefore;

    if (amountOrChecker instanceof Function) {
      assert.ok(
        amountOrChecker(actualChange),
        `For address "${address}", balance check failed (balance changed from ${balanceBefore} to ${balanceAfter}).`,
      );
    } else {
      const amount = amountOrChecker;
      assert.equal(
        actualChange,
        amount,
        `For address "${address}", expected balance to change by ${amount} (from ${balanceBefore} to ${balanceBefore + amount}), but got a change of ${actualChange} instead.`,
      );
    }
  });
}
