// node_modules/idb/build/index.js
var instanceOfAny = (object, constructors) => constructors.some((c) => object instanceof c);
var idbProxyableTypes;
var cursorAdvanceMethods;
function getIdbProxyableTypes() {
  return idbProxyableTypes || (idbProxyableTypes = [
    IDBDatabase,
    IDBObjectStore,
    IDBIndex,
    IDBCursor,
    IDBTransaction
  ]);
}
function getCursorAdvanceMethods() {
  return cursorAdvanceMethods || (cursorAdvanceMethods = [
    IDBCursor.prototype.advance,
    IDBCursor.prototype.continue,
    IDBCursor.prototype.continuePrimaryKey
  ]);
}
var transactionDoneMap = /* @__PURE__ */ new WeakMap();
var transformCache = /* @__PURE__ */ new WeakMap();
var reverseTransformCache = /* @__PURE__ */ new WeakMap();
function promisifyRequest(request) {
  const promise = new Promise((resolve, reject) => {
    const unlisten = () => {
      request.removeEventListener("success", success);
      request.removeEventListener("error", error);
    };
    const success = () => {
      resolve(wrap(request.result));
      unlisten();
    };
    const error = () => {
      reject(request.error);
      unlisten();
    };
    request.addEventListener("success", success);
    request.addEventListener("error", error);
  });
  reverseTransformCache.set(promise, request);
  return promise;
}
function cacheDonePromiseForTransaction(tx) {
  if (transactionDoneMap.has(tx))
    return;
  const done = new Promise((resolve, reject) => {
    const unlisten = () => {
      tx.removeEventListener("complete", complete);
      tx.removeEventListener("error", error);
      tx.removeEventListener("abort", error);
    };
    const complete = () => {
      resolve();
      unlisten();
    };
    const error = () => {
      reject(tx.error || new DOMException("AbortError", "AbortError"));
      unlisten();
    };
    tx.addEventListener("complete", complete);
    tx.addEventListener("error", error);
    tx.addEventListener("abort", error);
  });
  transactionDoneMap.set(tx, done);
}
var idbProxyTraps = {
  get(target, prop, receiver) {
    if (target instanceof IDBTransaction) {
      if (prop === "done")
        return transactionDoneMap.get(target);
      if (prop === "store") {
        return receiver.objectStoreNames[1] ? void 0 : receiver.objectStore(receiver.objectStoreNames[0]);
      }
    }
    return wrap(target[prop]);
  },
  set(target, prop, value) {
    target[prop] = value;
    return true;
  },
  has(target, prop) {
    if (target instanceof IDBTransaction && (prop === "done" || prop === "store")) {
      return true;
    }
    return prop in target;
  }
};
function replaceTraps(callback) {
  idbProxyTraps = callback(idbProxyTraps);
}
function wrapFunction(func) {
  if (getCursorAdvanceMethods().includes(func)) {
    return function(...args) {
      func.apply(unwrap(this), args);
      return wrap(this.request);
    };
  }
  return function(...args) {
    return wrap(func.apply(unwrap(this), args));
  };
}
function transformCachableValue(value) {
  if (typeof value === "function")
    return wrapFunction(value);
  if (value instanceof IDBTransaction)
    cacheDonePromiseForTransaction(value);
  if (instanceOfAny(value, getIdbProxyableTypes()))
    return new Proxy(value, idbProxyTraps);
  return value;
}
function wrap(value) {
  if (value instanceof IDBRequest)
    return promisifyRequest(value);
  if (transformCache.has(value))
    return transformCache.get(value);
  const newValue = transformCachableValue(value);
  if (newValue !== value) {
    transformCache.set(value, newValue);
    reverseTransformCache.set(newValue, value);
  }
  return newValue;
}
var unwrap = (value) => reverseTransformCache.get(value);
function openDB(name, version, { blocked, upgrade, blocking, terminated } = {}) {
  const request = indexedDB.open(name, version);
  const openPromise = wrap(request);
  if (upgrade) {
    request.addEventListener("upgradeneeded", (event) => {
      upgrade(wrap(request.result), event.oldVersion, event.newVersion, wrap(request.transaction), event);
    });
  }
  if (blocked) {
    request.addEventListener("blocked", (event) => blocked(
      // Casting due to https://github.com/microsoft/TypeScript-DOM-lib-generator/pull/1405
      event.oldVersion,
      event.newVersion,
      event
    ));
  }
  openPromise.then((db) => {
    if (terminated)
      db.addEventListener("close", () => terminated());
    if (blocking) {
      db.addEventListener("versionchange", (event) => blocking(event.oldVersion, event.newVersion, event));
    }
  }).catch(() => {
  });
  return openPromise;
}
var readMethods = ["get", "getKey", "getAll", "getAllKeys", "count"];
var writeMethods = ["put", "add", "delete", "clear"];
var cachedMethods = /* @__PURE__ */ new Map();
function getMethod(target, prop) {
  if (!(target instanceof IDBDatabase && !(prop in target) && typeof prop === "string")) {
    return;
  }
  if (cachedMethods.get(prop))
    return cachedMethods.get(prop);
  const targetFuncName = prop.replace(/FromIndex$/, "");
  const useIndex = prop !== targetFuncName;
  const isWrite = writeMethods.includes(targetFuncName);
  if (
    // Bail if the target doesn't exist on the target. Eg, getAll isn't in Edge.
    !(targetFuncName in (useIndex ? IDBIndex : IDBObjectStore).prototype) || !(isWrite || readMethods.includes(targetFuncName))
  ) {
    return;
  }
  const method = async function(storeName, ...args) {
    const tx = this.transaction(storeName, isWrite ? "readwrite" : "readonly");
    let target2 = tx.store;
    if (useIndex)
      target2 = target2.index(args.shift());
    return (await Promise.all([
      target2[targetFuncName](...args),
      isWrite && tx.done
    ]))[0];
  };
  cachedMethods.set(prop, method);
  return method;
}
replaceTraps((oldTraps) => ({
  ...oldTraps,
  get: (target, prop, receiver) => getMethod(target, prop) || oldTraps.get(target, prop, receiver),
  has: (target, prop) => !!getMethod(target, prop) || oldTraps.has(target, prop)
}));
var advanceMethodProps = ["continue", "continuePrimaryKey", "advance"];
var methodMap = {};
var advanceResults = /* @__PURE__ */ new WeakMap();
var ittrProxiedCursorToOriginalProxy = /* @__PURE__ */ new WeakMap();
var cursorIteratorTraps = {
  get(target, prop) {
    if (!advanceMethodProps.includes(prop))
      return target[prop];
    let cachedFunc = methodMap[prop];
    if (!cachedFunc) {
      cachedFunc = methodMap[prop] = function(...args) {
        advanceResults.set(this, ittrProxiedCursorToOriginalProxy.get(this)[prop](...args));
      };
    }
    return cachedFunc;
  }
};
async function* iterate(...args) {
  let cursor = this;
  if (!(cursor instanceof IDBCursor)) {
    cursor = await cursor.openCursor(...args);
  }
  if (!cursor)
    return;
  cursor = cursor;
  const proxiedCursor = new Proxy(cursor, cursorIteratorTraps);
  ittrProxiedCursorToOriginalProxy.set(proxiedCursor, cursor);
  reverseTransformCache.set(proxiedCursor, unwrap(cursor));
  while (cursor) {
    yield proxiedCursor;
    cursor = await (advanceResults.get(proxiedCursor) || cursor.continue());
    advanceResults.delete(proxiedCursor);
  }
}
function isIteratorProp(target, prop) {
  return prop === Symbol.asyncIterator && instanceOfAny(target, [IDBIndex, IDBObjectStore, IDBCursor]) || prop === "iterate" && instanceOfAny(target, [IDBIndex, IDBObjectStore]);
}
replaceTraps((oldTraps) => ({
  ...oldTraps,
  get(target, prop, receiver) {
    if (isIteratorProp(target, prop))
      return iterate;
    return oldTraps.get(target, prop, receiver);
  },
  has(target, prop) {
    return isIteratorProp(target, prop) || oldTraps.has(target, prop);
  }
}));

// app/lib/services/keydb-service.ts
var KEY_DB_NAME = "kdb";
var KEY_DB_VERSION = 1;
var KEY_STORE_NAME = "ak";
var keyDb;
var getDB = async () => {
  if (keyDb) {
    return keyDb;
  }
  try {
    keyDb = await openDB(KEY_DB_NAME, KEY_DB_VERSION, {
      upgrade(db) {
        db.createObjectStore(KEY_STORE_NAME);
      }
    });
    return keyDb;
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    throw new Error("Error opening key database");
  }
};
var getKey = async (keyId) => {
  const db = await getDB();
  const key = await db.get(KEY_STORE_NAME, keyId);
  if (!key) {
    return;
  }
  if (key.setOn < new Date((/* @__PURE__ */ new Date()).getDate() + 14).getTime()) {
    await db.delete(KEY_STORE_NAME, keyId);
    return;
  }
  return key.data;
};

// app/lib/helpers/binary-helpers.ts
var arrayToBase64 = (typedArray) => {
  let binary = "";
  const len = typedArray.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(typedArray[i]);
  }
  return btoa(binary);
};

// app/lib/services/crypto-service.ts
var createIv = () => crypto.getRandomValues(new Uint8Array(12));

// app/lib/workers/upload-worker.ts
var sendMessage = (message) => {
  postMessage(message);
};
onmessage = async (event) => {
  sendMessage({
    id: event.data.id,
    albumId: event.data.albumId,
    state: "preparing"
  });
  const data = event.data;
  if (!data.id || !data.albumId || !data.userId || !data.file) {
    sendMessage({
      id: data.id,
      albumId: event.data.albumId,
      error: "Missing required fields",
      state: "error"
    });
    return;
  }
  if (data.file.size > 1024 * 1024 * 10) {
    sendMessage({
      id: data.id,
      albumId: event.data.albumId,
      error: "File is too large",
      state: "error"
    });
    return;
  }
  const key = await getKey(data.albumId);
  if (!key) {
    sendMessage({
      id: data.id,
      albumId: event.data.albumId,
      error: "You don't have permission to upload to this album",
      state: "error"
    });
    return;
  }
  sendMessage({
    id: data.id,
    albumId: event.data.albumId,
    state: "encrypting"
  });
  const iv = createIv();
  const encryptedFile = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    await data.file.arrayBuffer()
  );
  sendMessage({
    id: data.id,
    albumId: event.data.albumId,
    state: "preparing_upload"
  });
  const resp = await fetch(`/albums/${data.albumId}/upload-url`, {
    method: "POST",
    body: JSON.stringify({ photoId: data.id, contentLength: encryptedFile.byteLength })
  });
  if (!resp.ok) {
    sendMessage({
      id: data.id,
      albumId: event.data.albumId,
      error: "Failed to create upload request",
      state: "error"
    });
    return;
  }
  const { url } = await resp.json();
  sendMessage({
    id: data.id,
    albumId: event.data.albumId,
    state: "uploading"
  });
  const uploadResp = await fetch(url, {
    method: "PUT",
    body: new Blob([encryptedFile], { type: "application/octet-stream" }),
    headers: {
      "Content-Type": "application/octet-stream"
    }
  });
  if (!uploadResp.ok) {
    sendMessage({
      id: data.id,
      albumId: event.data.albumId,
      error: "Failed to upload file",
      state: "error"
    });
    return;
  }
  sendMessage({
    id: data.id,
    albumId: event.data.albumId,
    state: "storing"
  });
  const storeRequest = await fetch(`/albums/${data.albumId}/photo`, {
    method: "POST",
    body: JSON.stringify({ photoId: data.id, iv: arrayToBase64(iv) })
  });
  if (!storeRequest.ok) {
    sendMessage({
      id: data.id,
      albumId: event.data.albumId,
      error: "Failed to store photo",
      state: "error"
    });
    return;
  }
  sendMessage({
    id: data.id,
    albumId: event.data.albumId,
    state: "done"
  });
  return;
};
