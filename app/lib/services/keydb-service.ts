import { openDB, DBSchema, IDBPDatabase } from "idb";

import { getDbKey } from "./crypto-service";

interface KeyDB extends DBSchema {
  ak: {
    key: string;
    value: {
      data: ArrayBuffer;
      setOn: number;
    };
  };
}

let keyDb: IDBPDatabase<KeyDB> | undefined;

const getDB = async () => {
  if (keyDb) {
    return keyDb;
  }
  keyDb = await openDB<KeyDB>("kdb", 1, {
    upgrade(db) {
      db.createObjectStore("ak");
    },
  });
  return keyDb;
};

export const storeKey = async (
  key: CryptoKey,
  keyId: string,
  userId: string
) => {
  const db = await getDB();
  const dbKey = await getDbKey(userId);
  const keyData = await crypto.subtle.wrapKey("raw", key, dbKey, {
    name: "AES-GCM",
    iv: new TextEncoder().encode(keyId + userId),
  });

  await db.add("ak", { data: keyData, setOn: new Date().getTime() }, keyId);
};

export const getKey = async (keyId: string, userId: string) => {
  const db = await getDB();
  const dbKey = await getDbKey(userId);
  const keyData = await db.get("ak", keyId);
  if (!keyData) {
    return;
  }
  const key = await crypto.subtle.unwrapKey(
    "raw",
    keyData.data,
    dbKey,
    {
      name: "AES-GCM",
      iv: new TextEncoder().encode(keyId + userId),
    },
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"]
  );

  // Delete the key if it is older than 14 days
  if (keyData.setOn < new Date(new Date().getDate() + 14).getTime()) {
    await db.delete("ak", keyId);
  }

  return key;
};
