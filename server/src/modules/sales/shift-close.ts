import type { MachineBinding } from '../../http/transitions.ts';

/**
 * The Shift machine on the till shift (§22.11; cash-management §2, §6). Its edges, keys and audit types are data:
 * `Open → Reconciling` (begin count) and `Reconciling → Closed` (close) both need `Shift.Close` (`CD-20`), and the
 * database refuses everything else, including the two edges OQ-014 leaves undecided. A shift belongs to its store's
 * organization; it has no organization column of its own.
 */
export const shiftMachine: MachineBinding = {
  machine: 'Shift',
  noun: 'shift',
  table: 'cash_shift',
  stateColumn: 'status',
  actorColumn: 'status_changed_by',
  storeColumn: 'store_id',
  organizationColumn: '(SELECT o.organization_id FROM store o WHERE o.id = cash_shift.store_id)',
};
