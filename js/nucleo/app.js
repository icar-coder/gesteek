Gestor.app = (() => {
  const modulos = new Map();
  let activo = null;

  const { $, el, vaciar } = Gestor.dom;
  const almacen = Gestor.almacen;

  /** Registra un módulo. Estructura esperada:
   *  { id, nombre, icono, montar(contenedor), desmontar?() }
   */
  function registrar(modulo){
    if(!modulo || !modulo.id) throw new Error('Módulo sin id');
    modulos.set(modulo.id, modulo);
  }

  function listaModulos(){ return [...modulos.values()]; }

  function ir(id){
    if(!modulos.has(id)) return;
    if(activo && modulos.get(activo).desmontar) {
      try{ modulos.get(activo).desmontar(); }catch(e){}
    }
    activo = id;

    // tabs
    document.querySelectorAll('#tabs button').forEach(b => {
      b.classList.toggle('activo', b.dataset.modulo === id);
    });

    // vista
    const vista = $('#vista');
    vaciar(vista);
    modulos.get(id).montar(vista);

    // recordar última pestaña
    try{ localStorage.setItem('gestor.pestana', id); }catch(e){}
  }

  function pintarTabs(){
    const tabs = $('#tabs');
    vaciar(tabs);
    for(const m of modulos.values()){
      tabs.append(el('button', {
        dataset: { modulo: m.id },
        texto: `${m.icono || ''} ${m.nombre}`.trim(),
        onclick: () => ir(m.id)
      }));
    }
  }

  // --- tema ---
  function aplicarTema(t){
    document.documentElement.dataset.tema = t;
    $('#btnTema').textContent = t === 'oscuro' ? '☀️' : '🌙';
    almacen.guardarTema(t);
  }
  function alternarTema(){
    aplicarTema(document.documentElement.dataset.tema === 'oscuro' ? 'claro' : 'oscuro');
  }

  function arrancar(){
    // tema
    let tema = almacen.leerTema();
    if(!tema){
      tema = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
    }
    aplicarTema(tema);
    $('#btnTema').addEventListener('click', alternarTema);

    // aviso si no hay localStorage
    if(!almacen.soportado){
      const aviso = $('#aviso');
      aviso.hidden = false;
      aviso.innerHTML = '⚠️ Este navegador no permite guardar datos automáticamente al abrir con <code>file://</code>. ' +
        'Usa <b>⬇️ Exportar</b> antes de cerrar (o ábrelo en Firefox).';
    }

    // export/import
    $('#btnExportar').addEventListener('click', () => almacen.exportarTodo(listaModulos()));
    $('#btnImportar').addEventListener('click', () => $('#fileInput').click());
    $('#fileInput').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if(!f) return;
      almacen.importarTodo(f, listaModulos(), (err) => {
        e.target.value = '';
        if(err){ alert('❌ ' + err.message); return; }
        alert('✅ Importado. Recargando…');
        location.reload();
      });
    });

    // tabs y arranque
    pintarTabs();
    const recordado = (() => { try{ return localStorage.getItem('gestor.pestana'); }catch(e){ return null; } })();
    const inicial = (recordado && modulos.has(recordado)) ? recordado : listaModulos()[0]?.id;
    if(inicial) ir(inicial);
  }

  return { registrar, ir, arrancar, listaModulos, get activo(){ return activo; } };
})();