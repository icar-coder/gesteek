Gestor.almacen = (() => {
  const PREFIJO = 'gestor.';
  const soportado = (() => {
    try{ localStorage.setItem('__t','1'); localStorage.removeItem('__t'); return true; }
    catch(e){ return false; }
  })();

  const clave = (modulo) => `${PREFIJO}${modulo}.v1`;

  function leer(modulo, porDefecto = null){
    if(!soportado) return porDefecto;
    try{
      const raw = localStorage.getItem(clave(modulo));
      return raw ? JSON.parse(raw) : porDefecto;
    }catch(e){ console.warn('almacen.leer:', e); return porDefecto; }
  }

  function escribir(modulo, datos){
    if(!soportado) return false;
    try{ localStorage.setItem(clave(modulo), JSON.stringify(datos)); return true; }
    catch(e){ console.warn('almacen.escribir:', e); return false; }
  }

  function borrar(modulo){
    if(!soportado) return;
    try{ localStorage.removeItem(clave(modulo)); }catch(e){}
  }

  const leerTema    = () => (soportado && localStorage.getItem(PREFIJO+'tema')) || null;
  const guardarTema = (t) => { try{ localStorage.setItem(PREFIJO+'tema', t); }catch(e){} };

  // FIX: no depender de Gestor.util (evita acoplamiento frágil al orden de scripts)
  function hoyISO(){
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function exportarTodo(modulos){
    const payload = {
      app: 'gestor',
      version: 1,
      exportado: new Date().toISOString(),
      datos: {}
    };
    for(const m of modulos){
      const d = leer(m.id);
      if(d) payload.datos[m.id] = d;
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `gestor-${hoyISO()}.json`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1500);
  }

  function importarTodo(file, modulos, alTerminar){
    const fr = new FileReader();
    fr.onload = () => {
      try{
        const data = JSON.parse(fr.result);
        // FIX: validación un poco más estricta
        if(!data || typeof data !== 'object' || !data.datos || typeof data.datos !== 'object'){
          throw new Error('Formato inválido');
        }
        for(const m of modulos){
          if(data.datos[m.id] !== undefined){
            escribir(m.id, data.datos[m.id]);
          }
        }
        alTerminar && alTerminar(null);
      }catch(err){ alTerminar && alTerminar(err); }
    };
    fr.onerror = () => alTerminar && alTerminar(new Error('No se pudo leer el archivo'));
    fr.readAsText(file);
  }

  return { soportado, leer, escribir, borrar, leerTema, guardarTema, exportarTodo, importarTodo };
})();