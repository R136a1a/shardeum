import { Transaction, TransactionFactory, TransactionType } from '@ethereumjs/tx'
import * as crypto from '@shardus/crypto-utils'
import { toBuffer } from 'ethereumjs-util'
import { ShardeumFlags } from '../shardeum/shardeumFlags'
import { InternalTx, InternalTXType } from '../shardeum/shardeumTypes'
import { Utils } from '@shardus/types'
import { DevSecurityLevel, Sign } from '@shardus/core/dist/shardus/shardus-types'
import { ethers } from 'ethers'

crypto.init('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')
crypto.setCustomStringifier(Utils.safeStringify, 'shardus_safeStringify')
export { crypto }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function verify(obj: any, expectedPk?: string): boolean {
  if (expectedPk) {
    if (obj.sign.owner !== expectedPk) return false
  }
  return crypto.verifyObj(obj)
}

export function isInternalTXGlobal(internalTx: InternalTx): boolean {
  return (
    internalTx.internalTXType === InternalTXType.SetGlobalCodeBytes ||
    internalTx.internalTXType === InternalTXType.ApplyChangeConfig ||
    internalTx.internalTXType === InternalTXType.InitNetwork ||
    internalTx.internalTXType === InternalTXType.ApplyNetworkParam
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isInternalTx(timestampedTx: any): boolean {
  if (timestampedTx && timestampedTx.raw) return false
  if (timestampedTx && timestampedTx.isInternalTx) return true
  if (timestampedTx && timestampedTx.tx && timestampedTx.tx.isInternalTx) return true
  return false
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isDebugTx(tx: any): boolean {
  return tx.isDebugTx != null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getTransactionObj(
  tx
): Transaction[TransactionType.Legacy] | Transaction[TransactionType.AccessListEIP2930] {
  if (!tx.raw) throw Error('fail')
  let transactionObj
  const serializedInput = toBuffer(tx.raw)
  try {
    transactionObj = TransactionFactory.fromSerializedData<TransactionType.Legacy>(serializedInput)
  } catch (e) {
    // if (ShardeumFlags.VerboseLogs) console.log('Unable to get legacy transaction obj', e)
  }
  if (!transactionObj) {
    try {
      transactionObj =
        TransactionFactory.fromSerializedData<TransactionType.AccessListEIP2930>(serializedInput)
    } catch (e) {
      if (ShardeumFlags.VerboseLogs) console.log('Unable to get transaction obj', e)
    }
  }

  if (transactionObj) {
    Object.freeze(transactionObj)
    return transactionObj
  } else throw Error('tx obj fail')
}

export function getInjectedOrGeneratedTimestamp(timestampedTx): number {
  const { tx, timestampReceipt } = timestampedTx
  let txnTimestamp: number

  if (timestampReceipt && timestampReceipt.timestamp) {
    txnTimestamp = timestampReceipt.timestamp
    if (ShardeumFlags.VerboseLogs) {
      console.log(`Timestamp ${txnTimestamp} is generated by the network nodes.`)
    }
  } else if (tx.timestamp) {
    txnTimestamp = tx.timestamp
    if (ShardeumFlags.VerboseLogs) {
      console.log(`Timestamp ${txnTimestamp} is extracted from the injected tx.`)
    }
  }
  // if timestamp is a float, round it down to nearest millisecond
  return Math.floor(txnTimestamp)
}

/**
 * This will request the sign field to be removed if one is present
 * All transactions should be hashed this way to avoid consistency issues
 * @param obj
 * @returns
 */
export function hashSignedObj(obj): string {
  if (ShardeumFlags.txHashingFix === false) {
    //if the feature is not on ignore the smart logic below and just hash the object
    return crypto.hashObj(obj)
  }

  if (!obj.sign) {
    return crypto.hashObj(obj)
  }
  return crypto.hashObj(obj, true)
}

/**
@param rawPayload: any - The original payload stripped of the signatures
@param sigs: Sign[] - The signatures to verify
@param allowedPubkeys: {[pubkey: string]: DevSecurityLevel} - The public keys that are allowed to sign the payload
@param minSigRequired: number - The minimum number of signatures required
@param requiredSecurityLevel: DevSecurityLevel - The minimum security level required to sign the payload
@returns boolean - True if the payload is signed by the required number of authorized public keys with the required security level
**/
export function verifyMultiSigs(
  rawPayload: object,
  sigs: Sign[],
  allowedPubkeys: { [pubkey: string]: DevSecurityLevel },
  minSigRequired: number,
  requiredSecurityLevel: DevSecurityLevel
): boolean {
  if (sigs.length < minSigRequired) return false

  // no reason to allow more signatures than allowedPubkeys exist
  // this also prevent loop exhaustion
  if (sigs.length > Object.keys(allowedPubkeys).length) return false

  let validSigs = 0
  const payload_hash = ethers.keccak256(ethers.toUtf8Bytes(Utils.safeStringify(rawPayload)))
  const seen = new Set()

  for (let i = 0; i < sigs.length; i++) {
    // The sig owner has not been seen before
    // The sig owner is listed on the server
    // The sig owner has enough security clearance
    // The signature is valid
    if (
      !seen.has(sigs[i].owner) &&
      allowedPubkeys[sigs[i].owner] &&
      allowedPubkeys[sigs[i].owner] >= requiredSecurityLevel &&
      ethers.verifyMessage(payload_hash, sigs[i].sig) === sigs[i].owner
    ) {
      validSigs++
      seen.add(sigs[i].owner)
    }

    if (validSigs >= minSigRequired) break
  }

  return validSigs >= minSigRequired
}
