import { ipc } from '@/ipc/manager';
import { AccountBackupData, Account } from '@/modules/account/types';

export function backupAccount(account: Account) {
  return ipc.client.database.backupAccount(account);
}

export function restoreAccount(backup: AccountBackupData) {
  return ipc.client.database.restoreAccount(backup);
}

export function getCurrentAccountInfo() {
  return ipc.client.database.getCurrentAccountInfo();
}
