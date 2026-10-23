(() => {
  const { el, vaciar } = Gestor.dom;
  const util = Gestor.util;
  const almacen = Gestor.almacen;

  const ID = 'tareas';
  let items = [];
  let editandoId = null;
  const filtro = { texto:'', estado:'todas', categoria:'todas', orden:'reciente' };
  let refs = {};
  let onKey = null;         // FIX: guardado para poder quitarlo en desmontar
  let tmrBuscar = null;     // FIX: cancelar debounce pendiente al desmontar

  const cargar = () => { items = almacen.leer(ID, []) || []; };
  const guardar = () => almacen.escribir(ID, items);

  function visibles(){
    const t = filtro.texto.trim().toLowerCase();
    const peso = { alta:0, media:1, baja:2 };
    const r = items.filter(it => {
      if(filtro.estado === 'pendientes' && it.hecha) return false;
      if(filtro.estado === 'hechas' && !it.hecha) return false;
      if(filtro.categoria !== 'todas' && it.categoria !== filtro.categoria) return false;
      if(t){
        const blob = `${it.titulo||''} ${it.notas||''} ${it.categoria||''}`.toLowerCase();
        if(!blob.includes(t)) return false;
      }
      return true;
    });
    r.sort((a,b) => {
      if(!!a.hecha !== !!b.hecha) return a.hecha ? 1 : -1;
      switch(filtro.orden){
        case 'fecha':
          if(!a.fecha && !b.fecha) return (b.creada||0)-(a.creada||0);
          if(!a.fecha) return 1; if(!b.fecha) return -1;
          return a.fecha.localeCompare(b.fecha);
        case 'prioridad': return (peso[a.prioridad]??1)-(peso[b.prioridad]??1);
        case 'titulo':    return (a.titulo||'').localeCompare(b.titulo||'','es');
        default:          return (b.creada||0)-(a.creada||0);
      }
    });
    return r;
  }

  function pintar(){
    const { lista, stats, selCat, datalist } = refs;
    if(!lista) return;

    const cats = [...new Set(items.map(i=>i.categoria).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,'es'));
    vaciar(selCat);
    selCat.append(el('option',{value:'todas',texto:'Todas las categorías'}));
    cats.forEach(c => selCat.append(el('option',{value:c,texto:c})));
    selCat.value = cats.includes(filtro.categoria) ? filtro.categoria : 'todas';
    filtro.categoria = selCat.value;

    vaciar(datalist);
    ['Personal','Trabajo','Estudio','Compras','Ideas', ...cats]
      .filter((v,i,a)=>a.indexOf(v)===i)
      .forEach(c => datalist.append(el('option',{value:c})));

    const vis = visibles();
    vaciar(lista);
    if(!vis.length){
      const v = el('div',{class:'vacio'});
      v.append(el('div',{texto: items.length ? '🔍 Nada coincide' : '🌱 Todavía no hay nada'}));
      v.append(el('div',{style:'margin-top:6px;font-size:13px',
        texto: items.length ? 'Cambia la búsqueda o los filtros.' : 'Pulsa "+ Nuevo" para empezar.'}));
      lista.append(v);
    } else {
      vis.forEach(it => lista.append(fila(it)));
    }

    const total = items.length;
    const hechas = items.filter(i=>i.hecha).length;
    const vencidas = items.filter(i=>!i.hecha && util.esVencida(i.fecha)).length;
    vaciar(stats);
    stats.append(el('span',{texto:`${total} en total`}));
    stats.append(el('span',{texto:`${total-hechas} pendientes`}));
    stats.append(el('span',{texto:`${hechas} hechas`}));
    if(vencidas) stats.append(el('span',{style:'color:#e5484d;font-weight:600',texto:`⚠️ ${vencidas} vencidas`}));
  }

  function fila(it){
    const check = el('input',{type:'checkbox',class:'check',title:'Marcar como hecha'});
    check.checked = !!it.hecha;
    check.addEventListener('change', () => {
      it.hecha = check.checked; guardar(); pintar();
    });

    const prio = el('span',{class:'prio '+(it.prioridad||'media')});

    const meta = el('div',{class:'meta'});
    if(it.categoria) meta.append(el('span',{class:'tag',texto:it.categoria}));
    if(it.fecha){
      const venc = !it.hecha && util.esVencida(it.fecha);
      meta.append(el('span',{class:'tag'+(venc?' vencida':''),texto:util.formatoFecha(it.fecha)}));
    }
    if(it.notas) meta.append(el('div',{class:'notas',texto:it.notas}));

    const cuerpo = el('div',{class:'cuerpo'},
      el('div',{class:'titulo',texto:it.titulo}),
      meta.children.length ? meta : null
    );

    const acciones = el('div',{class:'acciones'},
      el('button',{class:'icono',title:'Editar',texto:'✏️',onclick:()=>abrirEdicion(it.id)}),
      el('button',{class:'icono',title:'Eliminar',texto:'🗑️',onclick:()=>borrar(it.id)})
    );

    return el('li',{class:'item'+(it.hecha?' hecha':'')}, check, prio, cuerpo, acciones);
  }

  function borrar(id){
    const it = items.find(i=>i.id===id); if(!it) return;
    if(!confirm(`¿Eliminar "${it.titulo}"?`)) return;
    items = items.filter(i=>i.id!==id);
    guardar(); pintar();
  }

  function abrirNuevo(){
    editandoId = null;
    refs.form.reset();
    refs.dlgTitulo.textContent = 'Nueva cosa';
    refs.prioridad.value = 'media';
    refs.dlg.showModal();
    setTimeout(()=>refs.titulo?.focus(),50);
  }

  function abrirEdicion(id){
    const it = items.find(i=>i.id===id); if(!it) return;
    editandoId = id;
    refs.dlgTitulo.textContent = 'Editar';
    refs.titulo.value = it.titulo || '';
    refs.notas.value = it.notas || '';
    refs.categoria.value = it.categoria || '';
    refs.prioridad.value = it.prioridad || 'media';
    refs.fecha.value = it.fecha || '';
    refs.dlg.showModal();
    setTimeout(()=>refs.titulo?.focus(),50);
  }

  function montar(contenedor){
    const barra = el('section',{class:'barra'},
      el('input',{id:'t-buscar',type:'search',placeholder:'Buscar…'}),
      el('select',{id:'t-estado'},
        el('option',{value:'todas',texto:'Todas'}),
        el('option',{value:'pendientes',texto:'Pendientes'}),
        el('option',{value:'hechas',texto:'Hechas'})
      ),
      el('select',{id:'t-cat'}),
      el('select',{id:'t-orden'},
        el('option',{value:'reciente',texto:'Más recientes'}),
        el('option',{value:'fecha',texto:'Por fecha'}),
        el('option',{value:'prioridad',texto:'Por prioridad'}),
        el('option',{value:'titulo',texto:'Por título'})
      )
    );

    const cab = el('div',{style:'display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:8px;flex-wrap:wrap'},
      el('h2',{style:'font-size:17px',texto:'Tareas'}),
      el('button',{class:'primario',texto:'+ Nuevo',onclick:abrirNuevo})
    );

    const stats = el('section',{class:'stats'});
    const lista = el('ul',{class:'lista'});

    const dlg = el('dialog',{id:'t-dlg'});
    const form = el('form',{class:'form'});
    const dlgTitulo = el('h2',{style:'font-size:17px',texto:'Nueva cosa'});
    const titulo = el('input',{type:'text',maxlength:'120',placeholder:'¿Qué tienes que hacer?',required:'true'});
    const notas = el('textarea',{maxlength:'1000',placeholder:'Detalles, enlaces, recordatorios…'});
    const categoria = el('input',{list:'t-listaCats',maxlength:'30',placeholder:'Personal…'});
    const datalist = el('datalist',{id:'t-listaCats'});
    const prioridad = el('select',{},
      el('option',{value:'alta',texto:'🔴 Alta'}),
      el('option',{value:'media',selected:'true',texto:'🟡 Media'}),
      el('option',{value:'baja',texto:'🔵 Baja'})
    );
    const fecha = el('input',{type:'date'});

    form.append(
      dlgTitulo,
      el('div',{class:'campo'}, el('label',{texto:'Título *'}), titulo),
      el('div',{class:'campo'}, el('label',{texto:'Notas'}), notas),
      el('div',{class:'fila2'},
        el('div',{class:'campo'}, el('label',{texto:'Categoría'}), categoria, datalist),
        el('div',{class:'campo'}, el('label',{texto:'Prioridad'}), prioridad)
      ),
      el('div',{class:'campo'}, el('label',{texto:'Fecha límite'}), fecha),
      el('div',{class:'pie'},
        el('button',{type:'button',texto:'Cancelar',onclick:()=>dlg.close()}),
        el('button',{type:'submit',class:'primario',texto:'Guardar'})
      )
    );
    dlg.append(form);

    contenedor.append(cab, barra, stats, lista, dlg);

    refs = { dlg, form, dlgTitulo, titulo, notas, categoria, prioridad, fecha,
             lista, stats, selCat: barra.querySelector('#t-cat'), datalist };

    barra.querySelector('#t-buscar').addEventListener('input',(e)=>{
      clearTimeout(tmrBuscar); const v = e.target.value;
      tmrBuscar = setTimeout(()=>{ filtro.texto = v; pintar(); }, 130);
    });
    barra.querySelector('#t-estado').addEventListener('change',(e)=>{ filtro.estado = e.target.value; pintar(); });
    barra.querySelector('#t-orden').addEventListener('change',(e)=>{ filtro.orden = e.target.value; pintar(); });
    refs.selCat.addEventListener('change',(e)=>{ filtro.categoria = e.target.value; pintar(); });

    form.addEventListener('submit',(e)=>{
      e.preventDefault();
      const datos = {
        titulo: titulo.value.trim(),
        notas: notas.value.trim(),
        categoria: categoria.value.trim(),
        prioridad: prioridad.value,
        fecha: fecha.value
      };
      if(!datos.titulo){ titulo.focus(); return; }
      if(editandoId){
        const it = items.find(i=>i.id===editandoId);
        if(it) Object.assign(it, datos);
      } else {
        items.push({ id: util.uid(), ...datos, hecha:false, creada:Date.now() });
      }
      guardar(); dlg.close(); pintar();
    });

    dlg.addEventListener('click',(e)=>{
      const r = dlg.getBoundingClientRect();
      const fuera = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      if(fuera) dlg.close();
    });

    // FIX: guardamos la referencia para quitarla en desmontar
    onKey = (e) => {
      if(dlg.open) return;
      const tag = (e.target.tagName||'').toLowerCase();
      if(tag==='input'||tag==='textarea'||tag==='select') return;
      if(e.key==='n'||e.key==='N'){ e.preventDefault(); abrirNuevo(); }
      if(e.key==='/'){ e.preventDefault(); barra.querySelector('#t-buscar').focus(); }
    };
    document.addEventListener('keydown', onKey);

    cargar();
    pintar();
  }

  function desmontar(){
    // FIX: quitamos el listener global
    if(onKey){
      document.removeEventListener('keydown', onKey);
      onKey = null;
    }
    // FIX: cancelar debounce pendiente
    if(tmrBuscar){ clearTimeout(tmrBuscar); tmrBuscar = null; }
    // FIX: cerrar diálogo si quedó abierto
    try{ refs.dlg?.close(); }catch(e){}
    refs = {};
    editandoId = null;
  }

  Gestor.app.registrar({
    id: ID,
    nombre: 'Tareas',
    icono: '📋',
    montar,
    desmontar
  });
})();