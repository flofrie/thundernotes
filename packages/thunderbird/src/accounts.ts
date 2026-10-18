/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Accounts by their address (D42): Thunderbird's account ids differ between computers, so files
// name an account by the address of its default identity, and an import finds it by that.

/** The address an account is known by: its default identity's, else its name. */
export function accountAddress(account: tb.MailAccount): string {
  return account.identities?.[0]?.email ?? account.name;
}

/** Thunderbird's account id → address, for writing files. */
export async function addressesById(): Promise<Map<string, string>> {
  return new Map((await messenger.accounts.list(false)).map((a) => [a.id, accountAddress(a)]));
}

/** The account with an address (any of its identities, case ignored), for reading files. */
export async function accountByAddress(address: string): Promise<string | undefined> {
  const wanted = address.trim().toLowerCase();
  for (const a of await messenger.accounts.list(false)) {
    const addresses = [accountAddress(a), ...(a.identities ?? []).map((i) => i.email ?? "")].map((x) => x.toLowerCase());
    if (addresses.includes(wanted)) return a.id;
  }
  return undefined;
}
