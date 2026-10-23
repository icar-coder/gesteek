Gestor.blobstore = (() => {
  const DB = 'gestor.blobs';
  const STORE = 'archivos';
  let dbp = null;

  function abrir(){
    if(dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if(!db.objectStoreNames.contains(STORE)){
          db.createObjectStore(STORE); // key = id, value = Blob
        }
      };
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
    return dbp;
  }

  async function tx(modo, fn){
    const db = await abrir();
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, modo);
      const s = t.objectStore(STORE);
      const r = fn(s);
      t.oncomplete = () => res(r && r.result);
      t.onerror    = () => rej(t.error);
    });
  }

  const guardar = (id, blob) => tx('readwrite', s => s.put(blob, id));
  const leer    = (id) => tx('readonly',  s => s.get(id));
  const borrar  = (id) => tx('readwrite', s => s.delete(id));

  async function listarIds(){
    const db = await abrir();
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, 'readonly');
      const req = t.objectStore(STORE).getAllKeys();
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
  }

  async function vaciarTodo(){
    return tx('readwrite', s => s.clear());
  }

  return { guardar, leer, borrar, listarIds, vaciarTodo };
})();